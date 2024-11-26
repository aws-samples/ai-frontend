import React, { useState, useEffect } from "react";
import { MODELS } from "../constants/models";
import { useLearningStyle } from '../context/LearningStyle';
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
  Box,
  Button,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";

const Navigation = ({
  drawerOpen,
  setDrawerOpen,
  apiKey,
  onApiKeyChange,
  selectedModel,
  onModelChange,
  selectedUser,
  onUserChange,
  userMap,
  isUsersLoading,
  userData,
  showExplanation,
  setShowExplanation,
}) => {
  const { learningStyle, setLearningStyle } = useLearningStyle();

  const toggleDrawer = (open) => (event) => {
    if (
      event.type === "keydown" &&
      (event.key === "Tab" || event.key === "Shift")
    ) {
      return;
    }
    setDrawerOpen(open);
  };

  useEffect(() => {
    console.log(selectedUser, learningStyle);
    if (
      selectedUser == "e83a6587-3701-4d73-bd5d-57baa91e1558" ||
      selectedUser == "8d1a215b-1dd9-40d1-9821-82d15caecf76"
    ) {
      setLearningStyle("Provide technical explanation");
    } else {
      setLearningStyle("Provide examples");
    }
  }, [selectedUser]);

  const drawerList = (
    <List sx={{ p: 2 }}>
      <TextField
        sx={{ mb: 2 }}
        label="API key"
        variant="outlined"
        value={apiKey || process.env.REACT_APP_API_KEY || ""}
        onChange={onApiKeyChange}
        fullWidth
      />
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>Model</InputLabel>
        <Select value={selectedModel} label="Model" onChange={onModelChange}>
          <MenuItem value={MODELS.HAIKU}>Claude 3 Haiku</MenuItem>
          <MenuItem value={MODELS.SONNET}>Claude 3 Sonnet</MenuItem>
          <MenuItem value={MODELS.OPUS}>Claude 3 Opus</MenuItem>
          <MenuItem value={MODELS.TITAN}>Amazon Titan</MenuItem>
        </Select>
      </FormControl>
      <FormControl fullWidth sx={{ mb: 2 }}>
        <InputLabel>User</InputLabel>
        <Select
          value={selectedUser}
          label="User"
          onChange={onUserChange}
          disabled={isUsersLoading}
        >
          {Object.keys(userMap).map((name) => (
            <MenuItem key={userMap[name]} value={userMap[name]}>
              {name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      {selectedUser !== null && (
        <Box sx={{ mb: 3, p: 2, bgcolor: "background.paper", borderRadius: 1 }}>
          <Typography variant="body1" sx={{ mb: 2, px: 2 }}>
            Preferred learning style: {learningStyle}
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
                sx={{ mt: 1, color: "text.secondary", alignSelf: "stretch" }}
              >
                {JSON.stringify(userData, null, 2)}
              </Typography>
            )}
          </Box>
        </Box>
      )}
    </List>
  );

  return (
    <>
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
    </>
  );
};

export default Navigation;
