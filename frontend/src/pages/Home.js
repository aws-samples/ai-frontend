import "../assets/styles/Home.css";
import AuthenticationPage from "./Auth";
import ChatClient from "../services/Chat";
import ChatInputForm from "../components/ChatInputForm";
import ChatMessages from "../components/ChatMessages";
import Navigation from "../components/Navigation";
import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import USERS from "../constants/users";
import UserDataClient from "../services/UserData";
import { readPdf } from "../services/Pdf";
import { Typography, Paper } from "@mui/material";

function ChapterSummary({ chat, learningStyle }) {
  const [summary, setSummary] = useState("Generating summary...");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function getSummary() {
      if (!chat.documentText) return;

      setLoading(true);
      try {
        const message = `Summarize the key concepts of this text using markdown, in this format:
         # Key Concepts
         - First key concept and brief explanation
         - Second key concept and brief explanation
         (and so on)

         Keep it focused on the main ideas. Text to summarize:
         ${chat.documentText}`;

        const response = await chat.getResponseWithLearningStyle(
          message,
          "anthropic.claude-3-sonnet-20240229-v1:0",  // TODO: Swap out.
          learningStyle
        );
        setSummary(response);
      } catch (error) {
        console.error("Error getting summary:", error);
        setSummary("Failed to generate summary.");
      } finally {
        setLoading(false);
      }
    }

    getSummary();
  }, [chat, chat.documentText, learningStyle]);

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

function PdfViewer({ chat, filePath, learningStyle }) {
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
      <ChapterSummary chat={chat} learningStyle={learningStyle}/>
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

function HomePage() {
  const [apiKey, setApiKey] = useState(process.env.REACT_APP_API_KEY || "");
  const [learningStyle, setLearningStyle] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [chat] = useState(() => new ChatClient());
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
          setUserData(explanation);
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
      const agentOutput = await chat.getResponseWithLearningStyle(message, selectedModel, learningStyle);
      setMessages((prevMessages) => [...prevMessages, agentOutput]);
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
            learningStyle={learningStyle}
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
            onLearningStyleChange={(e) => setLearningStyle(e.target.value)}
          />
          <div className="main-section">
            <div className={`left ${pdfPath ? "with-preview" : ""}`}>
              <ChatMessages messages={messages} />
              <ChatInputForm
                inputDisabled={inputDisabled}
                onSendMessage={handleSendMessage}
                onFileUpload={handleFileUpload}
                onDownload={handleDownload}
              />
            </div>
            {pdfPath && (
              <div className="right">
                <PdfViewer chat={chat} filePath={pdfPath} learningStyle={learningStyle}/>
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
