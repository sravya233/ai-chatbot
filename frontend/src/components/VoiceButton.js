import React from "react";

function VoiceButton({ setMessage }) {

  const startVoiceInput = () => {

    const recognition =
      new window.webkitSpeechRecognition();

    recognition.lang = "en-US";

    recognition.onresult = (event) => {

      setMessage(
        event.results[0][0].transcript
      );
    };

    recognition.start();
  };

  return (
    <button onClick={startVoiceInput}>
      🎤
    </button>
  );
}

export default VoiceButton;