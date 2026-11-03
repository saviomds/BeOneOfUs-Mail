import "dotenv/config";
import { createApp } from "./app.js";

const PORT = process.env.PORT || 3000;
createApp().listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});