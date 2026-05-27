import React, { useState, useRef, useEffect } from "react";
import axios from "axios";
import Navbar from "./Navbar";
import Message from "./Message";
import VoiceButton from "./VoiceButton";

const API = "https://ai-chatbot-8teo.onrender.com";

function Chatbot() {
  const [message, setMessage]     = useState("");
  const [chat, setChat]           = useState([]);
  const [typing, setTyping]       = useState(false);
  const [history, setHistory]     = useState([]);
  const [darkMode, setDarkMode]   = useState(true);

  // Auth
  const [token, setToken]         = useState(localStorage.getItem("token") || "");
  const [username, setUsername]   = useState(localStorage.getItem("username") || "");
  const [authMode, setAuthMode]   = useState("login"); // "login" | "register"
  const [authForm, setAuthForm]   = useState({ username: "", password: "" });
  const [authError, setAuthError] = useState("");

  // PDF
  const [pdfText, setPdfText]     = useState("");
  const [pdfName, setPdfName]     = useState("");
  const [pdfMode, setPdfMode]     = useState(false);
  const [uploading, setUploading] = useState(false);

  const messagesEndRef = useRef(null);
  const fileInputRef   = useRef(null);

  const isLoggedIn = Boolean(token);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, typing]);

  // ── Auth ──────────────────────────────────────────────────────────────────

  const handleAuth = async () => {
    setAuthError("");
    try {
      if (authMode === "register") {
        await axios.post(`${API}/register`, authForm);
        setAuthMode("login");
        setAuthError("Account created! Please log in.");
        return;
      }
      // Login via form-urlencoded (OAuth2 requirement)
      const form = new URLSearchParams();
      form.append("username", authForm.username);
      form.append("password", authForm.password);
      const res = await axios.post(`${API}/login`, form);
      const t = res.data.access_token;
      setToken(t);
      setUsername(authForm.username);
      localStorage.setItem("token", t);
      localStorage.setItem("username", authForm.username);
    } catch (err) {
      setAuthError(err.response?.data?.detail || "Something went wrong");
    }
  };

  const logout = () => {
    setToken("");
    setUsername("");
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setChat([]);
    setHistory([]);
    setPdfText("");
    setPdfName("");
    setPdfMode(false);
  };

  const authHeaders = () => ({ Authorization: `Bearer ${token}` });

  // ── PDF Upload ────────────────────────────────────────────────────────────

  const handlePdfUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await axios.post(`${API}/upload-pdf`, form, {
        headers: { ...authHeaders(), "Content-Type": "multipart/form-data" },
      });
      setPdfText(res.data.text);
      setPdfName(res.data.filename);
      setPdfMode(true);
      setChat((prev) => [
        ...prev,
        { sender: "System", text: `PDF loaded: ${res.data.filename} (${res.data.chars} chars). Now ask questions about it!` },
      ]);
    } catch (err) {
      setChat((prev) => [
        ...prev,
        { sender: "System", text: "Failed to upload PDF. Try again." },
      ]);
    }
    setUploading(false);
    e.target.value = "";
  };

  // ── Send Message ──────────────────────────────────────────────────────────

  const sendMessage = async () => {
    if (!message.trim()) return;

    const userMsg = { sender: "You", text: message };
    setChat((prev) => [...prev, userMsg]);
    setHistory((prev) => [...prev, message]);
    setTyping(true);
    setMessage("");

    try {
      let res;
      if (pdfMode && pdfText) {
        res = await axios.post(
          `${API}/chat-pdf`,
          { message, pdf_text: pdfText },
          { headers: authHeaders() }
        );
      } else {
        res = await axios.post(
          `${API}/chat`,
          { message },
          { headers: authHeaders() }
        );
      }

      setTimeout(() => {
        setChat((prev) => [...prev, { sender: "Bot", text: res.data.reply }]);
        
        setTyping(false);
      }, 500);

    } catch (err) {
      if (err.response?.status === 401) {
        logout();
        return;
      }
      setChat((prev) => [
        ...prev,
        { sender: "System", text: "Server Error. Please try again." },
      ]);
      setTyping(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const speak = (text) => {
    const speech = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(speech);
  };

  const clearHistory = () => setHistory([]);

  // ── Login Screen ──────────────────────────────────────────────────────────

  if (!isLoggedIn) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height: "100vh", background: "#0f172a",
      }}>
        <div style={{
          background: "#1e293b", padding: "40px", borderRadius: "16px",
          width: "360px", boxShadow: "0 0 30px rgba(0,0,0,0.5)",
        }}>
          <h2 style={{ color: "white", textAlign: "center", marginTop: 0 }}>
            🎓 Campus AI
          </h2>
          <p style={{ color: "#94a3b8", textAlign: "center", marginBottom: "24px" }}>
            {authMode === "login" ? "Sign in to continue" : "Create your account"}
          </p>

          <input
            type="text"
            placeholder="Username"
            value={authForm.username}
            onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={authForm.password}
            onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && handleAuth()}
            style={{ ...inputStyle, marginTop: "12px" }}
          />

          {authError && (
            <p style={{ color: authMode === "register" && authError.includes("created") ? "#4ade80" : "#f87171", fontSize: "13px", marginTop: "8px" }}>
              {authError}
            </p>
          )}

          <button onClick={handleAuth} style={btnStyle}>
            {authMode === "login" ? "Login" : "Register"}
          </button>

          <p style={{ color: "#64748b", textAlign: "center", fontSize: "13px", marginTop: "16px" }}>
            {authMode === "login" ? "No account? " : "Have an account? "}
            <span
              onClick={() => { setAuthMode(authMode === "login" ? "register" : "login"); setAuthError(""); }}
              style={{ color: "#60a5fa", cursor: "pointer" }}
            >
              {authMode === "login" ? "Register" : "Login"}
            </span>
          </p>
        </div>
      </div>
    );
  }

  // ── Main Chat ─────────────────────────────────────────────────────────────

  return (
    <div className={darkMode ? "container dark" : "container light"}>

      {/* SIDEBAR */}
      <div className="sidebar">
        <h2>History</h2>

        <p style={{ fontSize: "12px", opacity: 0.5, textAlign: "center", marginTop: "-10px" }}>
          👤 {username}
        </p>

        <button onClick={logout} style={{
          width: "100%", padding: "7px", marginBottom: "8px",
          borderRadius: "8px", border: "none", background: "#475569",
          color: "white", cursor: "pointer", fontSize: "13px",
        }}>
          Logout
        </button>

        {history.length > 0 && (
          <button onClick={clearHistory} style={{
            width: "100%", padding: "7px", marginBottom: "12px",
            borderRadius: "8px", border: "none", background: "#ef4444",
            color: "white", cursor: "pointer", fontSize: "13px",
          }}>
            Clear History
          </button>
        )}

        {history.length === 0 && (
          <p style={{ opacity: 0.4, fontSize: "13px", textAlign: "center" }}>
            No history yet
          </p>
        )}

        {history.map((item, i) => (
          <div key={i} className="history-item" onClick={() => setMessage(item)} title="Click to reuse">
            {item.length > 35 ? item.slice(0, 35) + "..." : item}
          </div>
        ))}
      </div>

      {/* CHAT */}
      <div className="chat-section">
        <div className="chat-box">

          <Navbar darkMode={darkMode} setDarkMode={setDarkMode} />

          {/* PDF bar */}
          <div style={{
            padding: "8px 14px", background: pdfMode ? "#1d4ed8" : "#1e293b",
            display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap",
          }}>
            <button
              onClick={() => fileInputRef.current.click()}
              disabled={uploading}
              style={{
                padding: "5px 12px", borderRadius: "8px", border: "none",
                background: "#2563eb", color: "white", cursor: "pointer", fontSize: "12px",
              }}
            >
              {uploading ? "Uploading..." : "📄 Upload PDF"}
            </button>
            <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: "none" }} onChange={handlePdfUpload} />

            {pdfMode && (
              <>
                <span style={{ color: "white", fontSize: "12px" }}>📄 {pdfName}</span>
                <button
                  onClick={() => { setPdfMode(false); setPdfText(""); setPdfName(""); }}
                  style={{
                    padding: "3px 8px", borderRadius: "6px", border: "none",
                    background: "#ef4444", color: "white", cursor: "pointer", fontSize: "11px",
                  }}
                >
                  ✕ Remove
                </button>
              </>
            )}
            {pdfMode && (
              <span style={{ color: "#bfdbfe", fontSize: "11px" }}>PDF mode — asking about document</span>
            )}
          </div>

          {/* Messages */}
          <div className="messages">
            {chat.length === 0 && (
              <p style={{ textAlign: "center", opacity: 0.4, marginTop: "40px", fontSize: "15px" }}>
                Ask me anything...
              </p>
            )}
            {chat.map((msg, i) => (
              <Message key={i} sender={msg.sender} text={msg.text} />
            ))}
            {typing && (
              <div className="bot-message" style={{ opacity: 0.6 }}>Bot is typing...</div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="input-area">
            <input
              type="text"
              placeholder={pdfMode ? "Ask about the PDF..." : "Ask anything... (Enter to send)"}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button onClick={sendMessage}>Send</button>
            <VoiceButton setMessage={setMessage} />
          </div>

        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: "100%", padding: "12px", borderRadius: "8px",
  border: "1px solid #334155", background: "#0f172a",
  color: "white", fontSize: "14px", outline: "none",
  boxSizing: "border-box",
};

const btnStyle = {
  width: "100%", padding: "12px", marginTop: "16px",
  borderRadius: "8px", border: "none", background: "#2563eb",
  color: "white", fontSize: "15px", fontWeight: "bold", cursor: "pointer",
};

export default Chatbot;