import React, { useState } from "react";

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

export class ChatInputForm extends React.Component {
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

export default ChatInputForm;
