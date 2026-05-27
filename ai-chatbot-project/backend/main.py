from dotenv import load_dotenv
load_dotenv()

import logging
import os
import io
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

import aiosqlite
from groq import AsyncGroq
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, Field, field_validator
from passlib.context import CryptContext
from jose import JWTError, jwt
import pypdf

# ── Logging ───────────────────────────────────────────────────────────────────

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
DB_PATH      = os.getenv("DB_PATH", "chats.db")
SECRET_KEY   = os.getenv("SECRET_KEY", "change-this-secret-key-in-production")
ALGORITHM    = "HS256"
TOKEN_EXPIRE = 60 * 24  # 24 hours in minutes
MODEL        = "llama-3.3-70b-versatile"

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2  = OAuth2PasswordBearer(tokenUrl="login")

# ── Database ──────────────────────────────────────────────────────────────────

async def init_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                username   TEXT    UNIQUE NOT NULL,
                password   TEXT    NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS chats (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id      INTEGER NOT NULL,
                user_message TEXT    NOT NULL,
                bot_reply    TEXT    NOT NULL,
                created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            )
        """)
        await db.commit()
    log.info("Database ready at %s", DB_PATH)


async def get_user(username: str):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        )
        return await cursor.fetchone()


async def create_user(username: str, password: str):
    hashed = pwd_ctx.hash(password)
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute(
                "INSERT INTO users (username, password) VALUES (?, ?)",
                (username, hashed),
            )
            await db.commit()
            return True
        except Exception:
            return False  # username already exists


async def save_chat(user_id: int, user_message: str, bot_reply: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO chats (user_id, user_message, bot_reply) VALUES (?, ?, ?)",
            (user_id, user_message, bot_reply),
        )
        await db.commit()

# ── JWT helpers ───────────────────────────────────────────────────────────────

def create_token(username: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=TOKEN_EXPIRE)
    return jwt.encode(
        {"sub": username, "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


async def get_current_user(token: str = Depends(oauth2)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="Invalid token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = await get_user(username)
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return dict(user)

# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(title="Campus AI Backend", version="4.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"]
    
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Schemas ───────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=6)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)

    @field_validator("message", mode="before")
    @classmethod
    def strip_whitespace(cls, v: str) -> str:
        return v.strip()


class PDFChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    pdf_text: str = Field(..., max_length=10000)

# ── Groq AI ───────────────────────────────────────────────────────────────────

async def call_groq(user_message: str, system: str = None) -> str:
    if not GROQ_API_KEY:
        return "GROQ_API_KEY not set in .env file."
    try:
        client = AsyncGroq(api_key=GROQ_API_KEY)
        response = await client.chat.completions.create(
            model=MODEL,
            messages=[
                {
                    "role": "system",
                    "content": system or "You are a helpful AI assistant for a college/business. Answer clearly and concisely."
                },
                {"role": "user", "content": user_message}
            ],
            max_tokens=512,
            temperature=0.7,
        )
        return response.choices[0].message.content.strip()
    except Exception as exc:
        log.error("Groq error: %s", exc)
        return f"AI error: {str(exc)}"

# ── Auth Routes ───────────────────────────────────────────────────────────────

@app.post("/register")
async def register(req: RegisterRequest):
    success = await create_user(req.username, req.password)
    if not success:
        raise HTTPException(status_code=400, detail="Username already exists")
    return {"message": f"Account created for {req.username}"}


@app.post("/login")
async def login(form: OAuth2PasswordRequestForm = Depends()):
    user = await get_user(form.username)
    if not user or not pwd_ctx.verify(form.password, user["password"]):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    token = create_token(form.username)
    return {"access_token": token, "token_type": "bearer"}


@app.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return {"username": current_user["username"], "id": current_user["id"]}

# ── Chat Routes ───────────────────────────────────────────────────────────────

@app.get("/")
def home():
    return {"message": "Campus AI Backend Running", "version": "4.0.0"}


@app.post("/chat")
async def chat(
    request: ChatRequest,
    current_user: dict = Depends(get_current_user),
):
    bot_reply = await call_groq(request.message)
    try:
        await save_chat(current_user["id"], request.message, bot_reply)
    except Exception as exc:
        log.error("Failed to save chat: %s", exc)
    return {"reply": bot_reply}


@app.get("/history")
async def history(
    limit: int = 50,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            """
            SELECT id, user_message, bot_reply, created_at
            FROM chats
            WHERE user_id = ?
            ORDER BY id DESC LIMIT ? OFFSET ?
            """,
            (current_user["id"], limit, offset),
        )
        rows = await cursor.fetchall()
    return [dict(row) for row in rows]

# ── PDF Routes ────────────────────────────────────────────────────────────────

@app.post("/upload-pdf")
async def upload_pdf(
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    contents = await file.read()
    if len(contents) > 10 * 1024 * 1024:  # 10MB limit
        raise HTTPException(status_code=400, detail="PDF too large (max 10MB)")

    try:
        reader = pypdf.PdfReader(io.BytesIO(contents))
        text = ""
        for page in reader.pages:
            text += page.extract_text() or ""
        text = text.strip()[:10000]  # Limit to 10k chars
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {exc}")

    if not text:
        raise HTTPException(status_code=400, detail="No text found in PDF")

    log.info("PDF uploaded by %s — %d chars extracted", current_user["username"], len(text))
    return {"filename": file.filename, "text": text, "chars": len(text)}


@app.post("/chat-pdf")
async def chat_pdf(
    request: PDFChatRequest,
    current_user: dict = Depends(get_current_user),
):
    system = f"""You are a helpful assistant. Answer the user's question based ONLY on the document below.
If the answer is not in the document, say "I could not find that in the document."

DOCUMENT:
{request.pdf_text}"""

    bot_reply = await call_groq(request.message, system=system)

    try:
        await save_chat(current_user["id"], f"[PDF] {request.message}", bot_reply)
    except Exception as exc:
        log.error("Failed to save PDF chat: %s", exc)

    return {"reply": bot_reply}

# ── ML Routes ─────────────────────────────────────────────────────────────────

@app.post("/predict/dropout")
async def predict_dropout(
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """
    Simple rule-based dropout risk predictor.
    Replace with your trained ML model when ready.
    """
    attendance  = float(data.get("attendance_pct", 75))
    gpa         = float(data.get("gpa", 6.0))
    assignments = float(data.get("assignment_pct", 75))
    midterm     = float(data.get("midterm_score", 60))

    # Weighted risk score
    score = (
        (100 - attendance)  * 0.35 +
        (10  - gpa) * 5     * 0.25 +
        (100 - assignments) * 0.20 +
        (100 - midterm)     * 0.20
    )
    score = max(0, min(100, score))

    if score > 60:
        label = "High"
        recs  = ["Immediate counsellor referral", "Attendance warning letter", "Assign peer mentor"]
    elif score > 35:
        label = "Medium"
        recs  = ["Send attendance alert", "Schedule advisory session"]
    else:
        label = "Low"
        recs  = ["Continue routine monitoring"]

    return {
        "risk_score": round(score, 1),
        "risk_label": label,
        "recommendations": recs,
    }


@app.post("/predict/sentiment")
async def predict_sentiment(
    data: dict,
    current_user: dict = Depends(get_current_user),
):
    """Sentiment analysis using Groq."""
    text = data.get("text", "")
    if not text:
        raise HTTPException(status_code=400, detail="text field required")

    system = """Analyse the sentiment of the given text.
Reply with ONLY a JSON object like:
{"sentiment": "positive", "confidence": 0.92, "keywords": ["great", "helpful"]}
Sentiment must be one of: positive, neutral, negative."""

    result = await call_groq(text, system=system)

    try:
        import json
        parsed = json.loads(result)
        return parsed
    except Exception:
        return {"sentiment": "neutral", "confidence": 0.5, "raw": result}