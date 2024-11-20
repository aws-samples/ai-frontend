import HomePage from "./HomePage";
import HealthPage from "./HealthPage";
import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";

const Router = () => {
  return (
    <BrowserRouter>
    <Routes>
      <Route exact path="/" element={<HomePage />}/>
      <Route exact path="/health" element={<HealthPage />}/>
    </Routes>
    </BrowserRouter>
  );
};

export default Router;
