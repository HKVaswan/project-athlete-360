const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 3000;

app.use(cors());

// A placeholder API endpoint that returns a list of athletes
app.get('/api/athletes', (req, res) => {
  res.json([
    { id: 1, name: 'Sample Athlete 1' },
    { id: 2, name: 'Sample Athlete 2' },
    { id: 3, name: 'Sample Athlete 3' }
  ]);
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
