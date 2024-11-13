import "./HomePage.css";
import { Buffer } from "buffer";
import AuthenticationPage from "./Auth";
import React, { useState, useEffect } from "react";
import { Chat } from "./Chat";
import { UserDataClient } from "./UserData";
import {
  AppBar,
  Toolbar,
  IconButton,
  Typography,
  Drawer,
  List,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Box,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";

const USER_NAMES = ["Andrew", "Brad", "Christine", "Daniel", "Emma"];

async function readPdf(pdfFile) {
  const lambda = new LambdaClient({
    region: process.env.REGION || "us-west-2",
    credentials: {
      accessKeyId: process.env.REACT_APP_AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.REACT_APP_AWS_SECRET_ACCESS_KEY,
      sessionToken: process.env.REACT_APP_AWS_SESSION_TOKEN,
    },
  });

  const buffer = await pdfFile.arrayBuffer();
  const base64Content = Buffer.from(buffer).toString("base64");

  const command = new InvokeCommand({
    FunctionName: process.env.REACT_APP_PDF_FUNCTION_NAME || "",
    Payload: JSON.stringify({ pdf_content: base64Content }),
  });

  const response = await lambda.send(command);
  const payload = Buffer.from(response.Payload || "").toString();
  const result = JSON.parse(payload);

  if (result.statusCode !== 200) {
    throw new Error(result.body);
  }
  return result.body;
}

function PdfViewer({ filePath }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (filePath) {
      // Create URL for display
      const fileUrl = URL.createObjectURL(filePath);
      setUrl(fileUrl);

      // Extract text
      const reader = new FileReader();
      reader.onload = function (e) {
        const text = e.target.result;
        console.log("PDF text content:", text);
      };
      reader.readAsText(filePath);

      // Cleanup URL
      return () => URL.revokeObjectURL(fileUrl);
    }
  }, [filePath]);

  if (!filePath) return null;

  return (
    <div className="pdf-viewer">
      <h2 className="section-header">File Preview</h2>
      <embed
        src={url}
        type="application/pdf"
        width="100%"
        height="100%"
        style={{ border: "none" }}
      />
    </div>
  );
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
      await this.props.onFileUpload(file);
      this.handleCloseModal();
    } catch (error) {
      console.error("Error uploading file:", error);
      // TODO: Reasonable error handling.
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
            📎 Attach PDF
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
  const [apiKey, setApiKey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [chat] = useState(() => new Chat());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [inputDisabled, setInputDisabled] = useState(false);
  const [isUsersLoading, setIsUsersLoading] = useState(true);
  const [messages, setMessages] = useState([]);
  const [selectedModel, setSelectedModel] = useState(
    "anthropic.claude-3-sonnet-20240229-v1:0"
  );
  const [selectedUser, setSelectedUser] = useState(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [showThoughts, setShowThoughts] = useState(false);
  const [thoughts, setThoughts] = useState([]);
  const [pdfPath, setPdfPath] = useState(null);
  const [pdfText, setPdfText] = useState(null);
  const [userData, setUserData] = useState(null);
  const [userMap, setUserMap] = useState({});

  const userDataClient = new UserDataClient(chat);

  useEffect(() => {
    chat.setApiKey(apiKey || "");
  }, [apiKey, chat]);

  useEffect(() => {
    setInputDisabled(messages.length % 2 === 1);
  }, [messages]);

  useEffect(() => {
    const fetchAndMapUsers = async () => {
      try {
        const userIds = await userDataClient.listUserIds();
        const mappedUsers = userIds.reduce(
          (acc, id, index) => ({
            ...acc,
            [USER_NAMES[index]]: id,
          }),
          {}
        );
        setUserMap(mappedUsers);
        setIsUsersLoading(false);
        console.log("userMap:", userMap);
      } catch (error) {
        console.error("Failed to fetch users:", error);
        setIsUsersLoading(false);
      }
    };

    fetchAndMapUsers();
  }, []);

  useEffect(() => {
    const fetchUserData = async () => {
      if (selectedUser) {
        try {
          const docCounts =
            await userDataClient.getDocumentTypeCounts(selectedUser);
          setUserData(docCounts);
          console.log("User document counts:", docCounts);

          const explanation = await userDataClient.explainCustomization(
            selectedUser,
            docCounts,
            selectedModel
          );
          setUserData(explanation.reply);
        } catch (error) {
          console.error("Failed to fetch document counts:", error);
          setUserData(null);
        }
      } else {
        setUserData(null);
      }
    };

    fetchUserData();
  }, [selectedUser]);

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
    <List sx={{ p: 2 }}>
      {/* API key input. */}
      <TextField
        sx={{ mb: 2 }}
        label="API key"
        variant="outlined"
        value={apiKey}
        onChange={handleApiKeyChange}
        fullWidth
      />
      {/* Model selection. */}
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>Model</InputLabel>
        <Select
          value={selectedModel}
          label="Model"
          onChange={(e) => setSelectedModel(e.target.value)}
        >
          <MenuItem value="anthropic.claude-3-haiku-20240229-v1:0">
            Claude 3 Haiku
          </MenuItem>
          <MenuItem value="anthropic.claude-3-sonnet-20240229-v1:0">
            Claude 3 Sonnet
          </MenuItem>
          <MenuItem value="anthropic.claude-3-opus-20240229-v1:0">
            Claude 3 Opus
          </MenuItem>
        </Select>
      </FormControl>
      {/* User selection. */}
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>User</InputLabel>
        <Select
          value={selectedUser}
          label="User"
          onChange={(e) => setSelectedUser(e.target.value)}
          disabled={isUsersLoading}
        >
          {Object.keys(userMap).map((name) => (
            <MenuItem key={userMap[name]} value={userMap[name]}>
              {name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {/* User learning style. */}
      {selectedUser !== null && (
        <Box
          sx={{
            mb: 3,
            p: 2,
            bgcolor: "background.paper",
            borderRadius: 1,
          }}
        >
          <Typography variant="body1" sx={{ mb: 2, px: 2 }}>
            Preferred learning style:{" "}
            {selectedUser < 3
              ? "Provide technical explanation"
              : "Provide examples"}
          </Typography>

          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-end",
              mt: 1,
            }}
          >
            <Button
              onClick={() => setShowExplanation(!showExplanation)}
              sx={{
                p: 0,
                minWidth: "auto",
                fontSize: "0.75rem",
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "text.secondary",
              }}
            >
              explain why
            </Button>

            {showExplanation && (
              <Typography
                variant="caption"
                sx={{
                  mt: 1,
                  color: "text.secondary",
                  alignSelf: "stretch",
                }}
              >
                {JSON.stringify(userData, null, 2)}
              </Typography>
            )}
          </Box>
        </Box>
      )}
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

  async function getReply(message = "") {
    setThoughts([]); // Clear previous thoughts
    setInputDisabled(true);

    try {
      const agentOutput = await chat.getResponse(message, selectedModel);

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

  async function handleFileUpload(file) {
    try {
      chat.documentText = null
      setPdfPath(file);  // Sets the path for the PDF viewer.
      // Read the PDF.
      const pdfText = await readPdf(file);
      // Add it to the chat object.
      console.log(`Extracted text from PDF: ${pdfText}`);
      chat.documentText = pdfText
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
                alt=" "
                className="logo"
                style={{ height: "30px", marginRight: "10px" }}
              />
              <Typography variant="h6" style={{ flexGrow: 1 }}>
                AWS AI Assistant
              </Typography>
            </Toolbar>
          </AppBar>
          <Drawer
            anchor="left"
            open={drawerOpen}
            onClose={toggleDrawer(false)}
            PaperProps={{
              sx: {
                width: "min(100%, 500px)",
              },
            }}
          >
            {drawerList}
          </Drawer>
          <div className="main-section">
            <div className={`left ${pdfPath ? "with-preview" : ""}`}>
              <ChatContainer messages={messages} />
              <InputForm
                inputDisabled={inputDisabled}
                onSendMessage={handleSendMessage}
                onFileUpload={handleFileUpload}
                onDownload={handleDownload}
              />
            </div>
            {pdfPath && (
              <div className="right">
                <PdfViewer filePath={pdfPath} />
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
