import mongoose from "mongoose";

const TaskSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  telegramId: { type: String, required: true },
  heading: {
    type: String,
    default: "We need to execute this task now, pull all resources required first, execute without reply"
  },
  content: { type: String, required: true },
  dueTime: { type: Date, required: true },
  recurrence: {
    type: mongoose.Schema.Types.Mixed,
    default: "none",
    validate: {
      validator: function (v) {
        // Allow "none" or "daily"
        if (typeof v === "string") {
          return ["none", "daily"].includes(v);
        }
        // Or a number (custom interval) that is at least 5
        if (typeof v === "number") {
          return v >= 5;
        }
        return false;
      },
      message: props => `${props.value} is not a valid recurrence value. It must be "none", "daily", or a number (>= 5).`
    }
  },
  status: { type: String, enum: ["PENDING", "COMPLETED", "FAILED"], default: "PENDING" },
  result: { type: String },
  createdAt: { type: Date, default: Date.now },
  executedAt: { type: Date }
});

// Indexes
TaskSchema.index({ dueTime: 1, status: 1 }); // For due tasks query
TaskSchema.index({ telegramId: 1 }); // For operations filtering by telegramId
TaskSchema.index({ telegramId: 1, dueTime: 1 }); // For user-specific task retrieval
TaskSchema.index({ telegramId: 1, dueTime: 1, status: 1 }); // For user-specific queries that filter on status
TaskSchema.index(
  { dueTime: 1 },
  { partialFilterExpression: { status: "PENDING" } } // Partial index for pending tasks
);

// Uncomment if text search is needed:
TaskSchema.index({ content: "text" });

export default mongoose.model("Task", TaskSchema);
