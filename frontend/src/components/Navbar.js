import React from "react";

function Navbar({ darkMode, setDarkMode }) {

  return (

    <div className="navbar">

      <h2>AI Smart Assistant</h2>

      <button
        className="theme-btn"
        onClick={() =>
          setDarkMode(!darkMode)
        }
      >
        {
          darkMode ? "☀️" : "🌙"
        }
      </button>

    </div>
  );
}

export default Navbar;