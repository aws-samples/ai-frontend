import "./Home.css";
import Navigation from "../components/Navigation";
import ReactMarkdown from "react-markdown";
import { Buffer } from "buffer";
import AuthenticationPage from "./Auth";
import React, { useState, useEffect } from "react";
import { Chat } from "../services/Chat";
import { UserDataClient } from "../services/UserData";
import { Typography, Paper } from "@mui/material";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { USERS } from "../constants/users";

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
  const pdfBytes = Buffer.from(buffer).toString("base64");

  const command = new InvokeCommand({
    FunctionName: process.env.REACT_APP_PDF_FUNCTION_NAME || "",
    Payload: JSON.stringify({ pdf_content: String(pdfBytes) }),
  });

  const response = await lambda.send(command);
  const payload = Buffer.from(response.Payload || "").toString();
  const result = JSON.parse(payload);

  if (result.statusCode !== 200) {
    throw new Error(result.body);
  }
  return result.body;
}

function ChapterSummary({ chat }) {
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function getSummary() {
      if (!chat.documentText) return;

      setLoading(true);
      try {
        const prompt = `Summarize the key concepts of this text using markdown, in this format:
         # Key Concepts
         - First key concept and brief explanation
         - Second key concept and brief explanation
         (and so on)

         Keep it focused on the main ideas. Text to summarize:
         ${chat.documentText}`;

        const response = await chat.getResponse(
          prompt,
          "anthropic.claude-3-sonnet-20240229-v1:0"
        );
        setSummary(response.reply);
      } catch (error) {
        console.error("Error getting summary:", error);
        setSummary("Failed to generate summary");
      } finally {
        setLoading(false);
      }
    }

    getSummary();
  }, [chat, chat.documentText]);

  return (
    <Paper
      className="spaced-section"
      elevation={3}
      sx={{ minHeight: "fit-content", maxHeight: "800vh", overflowY: "auto" }}
    >
      <Typography variant="h6" gutterBottom>
        Chapter Concepts Summarized
      </Typography>
      {loading ? (
        <Typography>Generating summary...</Typography>
      ) : (
        <div className="markdown-body">
          <ReactMarkdown>{summary}</ReactMarkdown>
        </div>
      )}
    </Paper>
  );
}

function PdfViewer({ chat, filePath }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    if (filePath) {
      const fileUrl = URL.createObjectURL(filePath);
      setUrl(fileUrl);

      const reader = new FileReader();
      reader.onload = function (e) {
        const text = e.target.result;
      };
      reader.readAsText(filePath);

      return () => URL.revokeObjectURL(fileUrl);
    }
  }, [chat, filePath]);

  if (!filePath) return null;

  return (
    <div>
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
      <ChapterSummary chat={chat} />
      <div
        style={{
          height: "70px",
          backgroundColor: "#f3f3f3",
          width: "100%",
          marginTop: "10px",
        }}
      />
    </div>
  );
}

function UploadModal({ isOpen, onClose, onUpload }) {
  const [file, setFile] = useState(null);

  const handleFileChange = (e) => {
    setFile(e.target.files[0]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (file) {
      onUpload(file);
    }
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

  handleFileUpload = async (file) => {
    try {
      this.props.onFileUpload(file);
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [chat] = useState(() => new Chat());
  const [inputDisabled, setInputDisabled] = useState(false);
  const [isUsersLoading, setIsUsersLoading] = useState(true);
  const [messages, setMessages] = useState([]);
  const [selectedModel, setSelectedModel] = useState(
    "anthropic.claude-3-sonnet-20240229-v1:0"
  );
  const [selectedUser, setSelectedUser] = useState(null);
  const [showExplanation, setShowExplanation] = useState(false);
  const [pdfPath, setPdfPath] = useState(null);
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
            [USERS[index]]: id,
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

  const handleApiKeyChange = (event) => {
    setApiKey(event.target.value);
  };

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
      // Refresh the chat object.
      chat.documentText = null;

      // Set the path for the PDF viewer.
      setPdfPath(file);

      // Read it.
      const pdfText = await readPdf(file);

      // Add it to the chat object.
      console.log(`Extracted text from PDF: ${pdfText}`);
      chat.documentText = pdfText;
    } catch (error) {
      console.error("Error uploading file:", error);
      setMessages((prevMessages) => [
        ...prevMessages,
        `Error uploading file: ${error.message}`,
      ]);
    }
    setInputDisabled(false);
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
          <Navigation
            drawerOpen={drawerOpen}
            setDrawerOpen={setDrawerOpen}
            apiKey={apiKey}
            onApiKeyChange={handleApiKeyChange}
            selectedModel={selectedModel}
            onModelChange={(e) => setSelectedModel(e.target.value)}
            selectedUser={selectedUser}
            onUserChange={(e) => setSelectedUser(e.target.value)}
            userMap={userMap}
            isUsersLoading={isUsersLoading}
            userData={userData}
            showExplanation={showExplanation}
            setShowExplanation={setShowExplanation}
          />
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
                <PdfViewer chat={chat} filePath={pdfPath} />
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
