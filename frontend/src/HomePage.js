import "./HomePage.css";
import AuthenticationPage from "./Auth";
import React, { useState, useEffect } from "react";
import { Chat } from "./Chat";
import {
  Switch,
  FormControlLabel,
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Drawer,
  List,
  TextField,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";

class Thought {
  constructor(o) {
    this.type = o.type;
    try {
      if (o.type === "modelInvocationInput") {
        this.text = JSON.parse(o.data).messages.map(
          (message) => message.content
        )[0];
      } else if (o.type === "rationale") {
        this.text = o.data;
      } else if (o.type === "observation") {
        this.text = JSON.parse(o.data).response[0];
      } else if (o.type === "content") {
        this.text = o.data;
      }
      if (!this.text) {
        console.log(`Failed to type-cast thought: ${JSON.stringify(o)}`);
      }
      console.log("thought", this.text);
    } catch (e) {
      console.log(`Failed to type-cast thought: ${JSON.stringify(o)}`);
    }
  }
}

function UploadModal({ isOpen, onClose, onUpload }) {
  const [file, setFile] = useState(null);
  const [provideAnalysis, setProvideAnalysis] = useState(false);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (file) {
      onUpload(file, provideAnalysis);
    }
  };

  const handleCheckboxChange = () => {
    setProvideAnalysis((prev) => !prev);
  };

  if (!isOpen) return null;

  return (
    <div className="modal">
      <div className="modal-content">
        <h2>Upload File</h2>
        <form onSubmit={handleSubmit}>
          <input type="file" onChange={handleFileChange} />
          <div>
            <input
              type="checkbox"
              id="provideAnalysis"
              checked={provideAnalysis}
              onChange={handleCheckboxChange}
            />
            <label htmlFor="provideAnalysis" onClick={handleCheckboxChange}>
              Analyze conformance
            </label>
          </div>
          <button type="submit" disabled={!file}>
            Upload
          </button>
        </form>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function ChatContainer({ messages }) {
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

class InputForm extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      inputValue: "",
      isModalOpen: false,
    };
  }

  handleInputChange = (e) => {
    this.setState({ inputValue: e.target.value });
  };

  handleSubmit = (e) => {
    e.preventDefault();
    const { inputValue } = this.state;
    if (inputValue.trim() !== "") {
      this.props.onSendMessage(inputValue);
      this.setState({ inputValue: "" });
    }
  };

  handleOpenModal = () => {
    this.setState({ isModalOpen: true });
  };

  handleCloseModal = () => {
    this.setState({ isModalOpen: false });
  };

  handleFileUpload = async (file, provideAnalysis) => {
    try {
      await this.props.onFileUpload(file, provideAnalysis);
      this.handleCloseModal();
    } catch (error) {
      console.error("Error uploading file:", error);
      // Handle error (e.g., show an error message to the user)
    }
  };

  render() {
    const { inputDisabled, onDownload } = this.props;
    const { inputValue, isModalOpen } = this.state;

    return (
      <>
        <form onSubmit={this.handleSubmit} className="input-form">
          <input
            type="text"
            name="message"
            placeholder="Type your message"
            value={inputValue}
            onChange={this.handleInputChange}
            disabled={inputDisabled}
          />
          <button type="submit" disabled={inputDisabled}>
            ⏩ Send
          </button>
          <button type="button" onClick={this.handleOpenModal}>
            📎 Attach
          </button>
          <button type="button" onClick={onDownload}>
            💾 Download Chat
          </button>
        </form>
        <UploadModal
          isOpen={isModalOpen}
          onClose={this.handleCloseModal}
          onUpload={this.handleFileUpload}
        />
      </>
    );
  }
}

function HomePage() {
  const [messages, setMessages] = useState([]);
  const [thoughts, setThoughts] = useState([]);
  const [inputDisabled, setInputDisabled] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [showThoughts, setShowThoughts] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [chat] = useState(() => new Chat());

  useEffect(() => {
    chat.setApiKey(apiKey || "");
  }, [apiKey, chat]);

  useEffect(() => {
    setInputDisabled(messages.length % 2 === 1);
  }, [messages]);

  const toggleDrawer = (open) => (event) => {
    if (
      event.type === "keydown" &&
      (event.key === "Tab" || event.key === "Shift")
    ) {
      return;
    }
    setDrawerOpen(open);
  };

  const handleApiKeyChange = (event) => {
    setApiKey(event.target.value);
  };

  const drawerList = (
    <List>
      <TextField
        label="API Key"
        variant="outlined"
        value={apiKey}
        onChange={handleApiKeyChange}
        fullWidth
      />
      <FormControlLabel
        control={
          <Switch
            checked={showThoughts}
            onChange={() => setShowThoughts(!showThoughts)}
          />
        }
        label="Show Thoughts"
      />
    </List>
  );

  const handleAuthentication = () => {
    setAuthenticated(true);
  };

  async function handleSendMessage(newMessage) {
    if (newMessage.trim() !== "") {
      setMessages((prevMessages) => [...prevMessages, newMessage]);
      setInputDisabled(true);
      await getReply(newMessage);
    }
  }

  async function getReply(message = "", isReview = false) {
    setThoughts([]); // Clear previous thoughts
    setInputDisabled(true);

    try {
      const thoughtCallback = (thought) => {
        setThoughts((prevThoughts) => [...prevThoughts, new Thought(thought)]);
      };

      const agentOutput = await chat.getResponse(
        message,
        thoughtCallback,
        isReview
      );

      let finalMessage = agentOutput.reply;
      if (agentOutput.sources && agentOutput.sources.length > 0) {
        finalMessage += "\n\nSources:";
        agentOutput.sources.forEach((source) => {
          finalMessage += `\n• ${source}`;
        });
      }

      setMessages((prevMessages) => [...prevMessages, finalMessage]);
    } catch (error) {
      console.error("Error getting response:", error);
      setMessages((prevMessages) => [
        ...prevMessages,
        "Error -- something went wrong.",
      ]);
    } finally {
      setInputDisabled(false);
    }
  }

  async function handleFileUpload(file, provideAnalysis = false) {
    try {
      const result = await chat.uploadFile(file);
      console.log(result);

      if (provideAnalysis) {
        setMessages((prevMessages) => [
          ...prevMessages,
          `User uploaded file: "${file.name}"`,
        ]);
        getReply("", true);
      } else {
        setMessages((prevMessages) => [
          ...prevMessages,
          `User uploaded file: "${file.name}"`,
          `File "${file.name}" uploaded successfully`,
        ]);
      }

      setInputDisabled(false);
    } catch (error) {
      console.error("Error uploading file:", error);
      setMessages((prevMessages) => [
        ...prevMessages,
        `Error uploading file: ${error.message}`,
      ]);
      setInputDisabled(false);
    }
  }

  const handleDownload = () => {
    const content = messages
      .map(
        (message, index) => `${index % 2 === 0 ? "User" : "Bot"}: ${message}`
      )
      .join("\n\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "chat-history.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="HomePage">
      {authenticated ? (
        <div>
          <AppBar position="sticky" style={{ backgroundColor: "#232F3E" }}>
            <Toolbar>
              <IconButton
                edge="start"
                aria-label="menu"
                onClick={toggleDrawer(true)}
              >
                <MenuIcon style={{ color: "white" }} />
              </IconButton>
              <img
                src={process.env.PUBLIC_URL + "/aws_logo.png"}
                alt="AWS logo"
                className="logo"
                style={{ height: "30px", marginRight: "10px" }}
              />
              <Typography variant="h6" style={{ flexGrow: 1 }}>
                AWS AI Assistant
              </Typography>
            </Toolbar>
          </AppBar>
          <Drawer anchor="left" open={drawerOpen} onClose={toggleDrawer(false)}>
            {drawerList}
          </Drawer>
          <div className="main-section">
            <div className="left">
              <ChatContainer messages={messages} />
              <InputForm
                inputDisabled={inputDisabled}
                onSendMessage={handleSendMessage}
                onFileUpload={handleFileUpload}
                onDownload={handleDownload}
              />
            </div>
            {showThoughts && (
              <div className="right">
                <h2 className="section-header">Trail of Thought</h2>
                <div className="thoughts-container">
                  <div className="thoughts">
                    {thoughts.map((thought, index) => (
                      <div key={index} className="message bot">
                        <React.Fragment key={index}>
                          {thought.text}
                          <br />
                        </React.Fragment>
                      </div>
                    ))}
                    <div className="hacky-spacer" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <AuthenticationPage onAuthenticated={handleAuthentication} />
      )}
    </div>
  );
}

export default HomePage;
