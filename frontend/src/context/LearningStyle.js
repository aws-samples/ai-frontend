import React, { createContext, useContext, useState } from 'react';

const LearningStyleContext = createContext();

export function LearningStyleProvider({ children }) {
  const [learningStyle, setLearningStyle] = useState('');

  return (
    <LearningStyleContext.Provider value={{ learningStyle, setLearningStyle }}>
      {children}
    </LearningStyleContext.Provider>
  );
}

export function useLearningStyle() {
  const context = useContext(LearningStyleContext);
  if (context === undefined) {
    throw new Error('useLearningStyle must be used within a LearningStyleProvider');
  }
  return context;
}

