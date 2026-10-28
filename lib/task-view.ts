import type { TaskView } from "@/components/tasks/TaskForms";
import type { TaskRow } from "@/lib/dal/tasks";

/** Only what the browser needs from a task row. */
export const toTaskView = (t: TaskRow): TaskView => ({
  id: t.id,
  title: t.title,
  description: t.description,
  status: t.status,
  priority: t.priority,
  assigneeId: t.assigneeId,
  assigneeName: t.assigneeName,
  assigneeAvatar: t.assigneeAvatar,
  dueDate: t.dueDate,
  labels: t.labels,
  checklist: t.checklist,
  checklistDone: t.checklistDone,
  comments: t.comments,
  overdue: t.overdue,
  canEdit: t.canEdit,
  canDelete: t.canDelete,
});
