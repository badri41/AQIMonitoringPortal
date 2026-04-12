require("dotenv").config();

BigInt.prototype.toJSON = function () {
  return this.toString();
};

const cors = require("cors");
const express = require("express");


const apiRouter = require("./routes");
const { closePool } = require("./db/connections");

const app = express();
const port = Number(process.env.PORT || 4000);
const frontendOrigin = process.env.FRONTEND_ORIGIN || "http://localhost:5173";

app.use(
	cors({
		origin: frontendOrigin,
	}),
);
app.use(express.json());

app.use("/api", apiRouter);

app.use((req, res) => {
	res.status(404).json({ error: "Route not found" });
});

app.use((error, req, res, next) => {
	if (res.headersSent) {
		return next(error);
	}

	console.error("Unhandled error:", error);
	return res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(port, () => {
	console.log(`Backend listening on port ${port}`);
});

async function shutdown(signal) {
	console.log(`Received ${signal}. Closing server...`);
	server.close(async () => {
		try {
			await closePool();
			console.log("Database pool closed.");
		} catch (error) {
			console.error("Error while closing database pool:", error);
		}
		process.exit(0);
	});
}

process.on("SIGINT", () => {
	shutdown("SIGINT");
});

process.on("SIGTERM", () => {
	shutdown("SIGTERM");
});

module.exports = app;
