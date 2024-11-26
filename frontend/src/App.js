import HomePage from "./pages/Home";
import HealthPage from "./pages/Health";
import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LearningStyleProvider } from './context/LearningStyle';

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route exact path="/" element={
          <LearningStyleProvider>
            <HomePage />
          </LearningStyleProvider>
        } />
        <Route exact path="/health" element={<HealthPage />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
