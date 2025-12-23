import React, { useState, useEffect } from "react";
import { Box, render, Text } from "ink";

const Counter = () => {
  const [counter, setCounter] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCounter((previousCounter) => previousCounter + 1);
    }, 100);

    return () => {
      clearInterval(timer);
    };
  }, []);

  return (
    <Box width={40} height={20} borderColor={"green"} borderStyle={"classic"}>
      <Text color="green">{counter} tests passed</Text>
    </Box>
  );
};

render(<Counter />);
