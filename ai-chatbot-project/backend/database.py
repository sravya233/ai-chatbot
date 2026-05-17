import sqlite3

def connect_db():

    conn = sqlite3.connect("chatbot.db")

    conn.execute("""
    CREATE TABLE IF NOT EXISTS chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_message TEXT,
        bot_reply TEXT
    )
    """)

    return conn