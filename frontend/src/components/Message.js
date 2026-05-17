import React from "react";

function Message({ sender, text }) {

  return (
    <div
      className={
        sender === "You"
          ? "user-message"
          : "bot-message"
      }
    >
      <strong>{sender}</strong>
      <p>{text}</p>
    </div>
  );
}

export default Message;