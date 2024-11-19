import React, { useState } from "react";

const AuthenticationPage = ({ onAuthenticated }) => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = () => {
    // Retrieve the username and password from environment variables or your secure storage
    const correctUsername = process.env.REACT_APP_USERNAME;
    const correctPassword = process.env.REACT_APP_PASSWORD;

    if (username === correctUsername && password === correctPassword) {
      onAuthenticated();
    } else {
      setError("Incorrect username or password. Please try again.");
    }
  };

  return (
    <div>
      <h2>Login Required</h2>
      <div>
        <label>Username:</label>
        <input
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>
      <div>
        <label>Password:</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <button onClick={handleLogin}>Login</button>
    </div>
  );
};

export default AuthenticationPage;
