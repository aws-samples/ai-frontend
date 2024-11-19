import React from "react";
import { MODELS } from "../constants/models";
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
  const toggleDrawer = (open) => (event) => {
    if (
      event.type === "keydown" &&
      (event.key === "Tab" || event.key === "Shift")
    ) {
      return;
    }
    setDrawerOpen(open);
  };

  const drawerList = (
    <List sx={{ p: 2 }}>
      <TextField
        sx={{ mb: 2 }}
        label="API key"
        variant="outlined"
        value={apiKey}
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
