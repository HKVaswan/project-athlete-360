const express = require('express');
const cors = require('cors'); // <-- Add this line
const app = express();
const port = process.env.PORT || 3000;

app.use(cors()); // <-- Add this line

app.get('/', (req, res) => {
  res.send('Hello from the backend!');
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
