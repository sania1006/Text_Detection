const path = require("path");

// These lines tell Vercel's bundler to include the required files
try { require.resolve("sql.js/dist/sql-wasm.wasm"); } catch (e) {}
try { require.resolve("pdf-parse"); } catch (e) {}

// Force load env if it exists (for local testing via vercel dev)
try { 
  require("dotenv").config({ path: path.join(__dirname, "../backend/.env") }); 
} catch (e) {}

module.exports = require("../backend/server");
