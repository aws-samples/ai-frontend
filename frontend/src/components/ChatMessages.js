import React from "react";

export function ChatMessages({ messages }) {
  return (
    <div>
      <h2 className="section-header">Main Chat</h2>
      <div className="chat-container">
        <div className="chat">
          <div className="messages">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`message ${index % 2 === 0 ? "user" : "bot"}`}
              >
                {message.split("\n").map((line, i) => (
                  <React.Fragment key={i}>
                    {line.startsWith("• ") ? (
                      <li>{line.substring(2)}</li>
                    ) : (
                      <>
                        {line}
                        <br />
                      </>
                    )}
                  </React.Fragment>
                ))}
              </div>
            ))}
            <div className="hacky-spacer" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChatMessages;
