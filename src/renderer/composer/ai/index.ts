// Local AI in the composer (T6, XBOT-4BCGOR): the ✦ menu, the suggestions
// sheet, the status row, and the setup pieces the onboarding steps and the
// settings sections reuse. Everything that imports these is on the composer
// page, so the stylesheet below loads once there.
import './ai.css';

export { canUndo, insertThroughEditor, planApply, type SelectionRef, type UndoEntry } from './aiApply';
export { AiMenu, unavailableReason, type MenuContext } from './AiMenu';
export { AiStatusRow, type AiStatus } from './AiStatusRow';
export { ModelPicker } from './ModelPicker';
export { chipFor, CloudOffNote, OllamaCheck } from './OllamaCheck';
export { SuggestionsSheet } from './SuggestionsSheet';
export { useAiRun, type AiRun } from './useAiRun';
export { useAiState } from './useAiState';
