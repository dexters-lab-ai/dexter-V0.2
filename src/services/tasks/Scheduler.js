import TasksService from "./TasksService.js";
import { bot } from "../../core/bot.js";

export function startDueTasksScheduler() {
  const intervalMs = 5 * 60 * 1000; // 10 minutes
  setInterval(async () => {
    try {
      const processedCount = await TasksService.processDueTasks(bot);
      if (processedCount > 0) {
        console.log(
          `Processed ${processedCount} due tasks at ${new Date().toISOString()}`
        );
      }
    } catch (error) {
      console.error("Error processing due tasks:", error);
    }
  }, intervalMs);
}

