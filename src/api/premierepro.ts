import { premierepro, uxp } from "../globals";
import { asTransaction, lockedTransaction } from "./utils/premierepro-utils";
import type {
  Project,
  Sequence,
  ClipProjectItem,
  VideoTrack,
  AudioTrack,
} from "../types/ppro";

// Native shell addon disabled in this fork. The CEP adapter uses execFile argument arrays.
const addon: any = null;

export const notify = async (message: string) => {
  alert(message);
};

const PREMIERE_TICKS_PER_SECOND = 254016000000;

export const getActiveSequenceInfo = async () => {
  try {
    const project = await premierepro.Project.getActiveProject();
    if (!project) return null;
    const sequence = await project.getActiveSequence();
    if (!sequence) return null;

    const settings = await sequence.getSettings();
    const frameRect = await settings.getVideoFrameRect();
    const endTime = await sequence.getEndTime();
    const timebase = await sequence.getTimebase();
    const ticksPerFrame = parseInt(timebase);
    const frameRate = ticksPerFrame > 0
      ? PREMIERE_TICKS_PER_SECOND / ticksPerFrame
      : 24;

    console.log("getActiveSequenceInfo", {
      timebase,
      ticksPerFrame,
      frameRate,
      duration: endTime.seconds,
    });

    return {
      id: sequence.guid.toString(),
      name: sequence.name,
      duration: endTime.seconds,
      frameRate: Math.round(frameRate * 100) / 100,
      frameWidth: frameRect.width,
      frameHeight: frameRect.height,
    };
  } catch (e) {
    console.error("getActiveSequenceInfo failed:", e);
    return null;
  }
};

export const fetchTranscriptJSON = async (): Promise<string | null> => {
  try {
    const project = await premierepro.Project.getActiveProject();
    if (!project) return null;
    const sequence = await project.getActiveSequence();
    if (!sequence) return null;

    const seqProjectItem = await sequence.getProjectItem();
    const clipItem = premierepro.ClipProjectItem.cast(seqProjectItem);
    const json = await premierepro.Transcript.exportToJSON(clipItem);

    if (json && json.length > 2) {
      return json;
    }

    return null;
  } catch (e) {
    console.error("fetchTranscriptJSON failed:", e);
    return null;
  }
};

export const checkTranscriptExists = async (): Promise<boolean> => {
  const json = await fetchTranscriptJSON();
  return json !== null;
};

let sequenceActivatedHandler: ((event?: Object) => void) | null = null;
let sequenceClosedHandler: ((event?: Object) => void) | null = null;

export const registerSequenceListeners = async (
  onActivated: () => void,
  onClosed: () => void,
) => {
  try {
    if (sequenceActivatedHandler) {
      premierepro.EventManager.removeGlobalEventListener(
        premierepro.Constants.SequenceEvent.ACTIVATED,
        sequenceActivatedHandler,
      );
    }
    if (sequenceClosedHandler) {
      premierepro.EventManager.removeGlobalEventListener(
        premierepro.Constants.SequenceEvent.CLOSED,
        sequenceClosedHandler,
      );
    }

    sequenceActivatedHandler = () => onActivated();
    sequenceClosedHandler = () => onClosed();

    premierepro.EventManager.addGlobalEventListener(
      premierepro.Constants.SequenceEvent.ACTIVATED,
      sequenceActivatedHandler,
    );
    premierepro.EventManager.addGlobalEventListener(
      premierepro.Constants.SequenceEvent.CLOSED,
      sequenceClosedHandler,
    );
  } catch (e) {
    console.error("registerSequenceListeners failed:", e);
  }
};

export const importFileToProject = async (filePath: string): Promise<boolean> => {
  try {
    const project = await premierepro.Project.getActiveProject();
    return await project.importFiles([filePath], true);
  } catch (e) {
    console.error("importFileToProject failed:", e);
    return false;
  }
};

export const insertOverlayToTimeline = async (
  filePath: string,
  startTimeSeconds: number,
  videoTrackIndex: number,
): Promise<boolean> => {
  try {
    const project = await premierepro.Project.getActiveProject();
    const sequence = await project.getActiveSequence();
    if (!sequence) return false;

    const imported = await project.importFiles([filePath], true);
    if (!imported) return false;

    // Find the imported item
    const root = await project.getRootItem();
    const items = await root.getItems();
    const fileName = filePath.split("/").pop()?.split("\\").pop() || "";
    const importedItem = items.find((item) => item.name.includes(fileName.replace(/\.[^.]+$/, "")));

    if (!importedItem) return false;

    const editor = premierepro.SequenceEditor.getEditor(sequence);
    const time = premierepro.TickTime.createWithSeconds(startTimeSeconds);
    const insertAction = editor.createInsertProjectItemAction(
      importedItem,
      time,
      videoTrackIndex,
      -1,
      false,
    );

    lockedTransaction(project, [insertAction], "Insert Caption Overlay");
    return true;
  } catch (e) {
    console.error("insertOverlayToTimeline failed:", e);
    return false;
  }
};

export const getProjectInfo = async () => {
  const project = await premierepro.Project.getActiveProject();
  return {
    name: project.name,
    path: project.path,
    id: project.guid.toString(),
  };
};

export const saveFrameBatch = async (
  frames: string[],
  outputFolderPath: string,
  startIndex: number,
  baseName: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const fs = uxp.storage.localFileSystem;
    const outputFolder = await fs.getEntryWithUrl(`file:${outputFolderPath}`);

    for (let i = 0; i < frames.length; i++) {
      const frameNum = String(startIndex + i).padStart(6, "0");
      const fileName = `${baseName}_${frameNum}.png`;
      const file = await outputFolder.createFile(fileName, { overwrite: true });

      const binaryStr = atob(frames[i]);
      const bytes = new Uint8Array(binaryStr.length);
      for (let j = 0; j < binaryStr.length; j++) {
        bytes[j] = binaryStr.charCodeAt(j);
      }

      await file.write(bytes.buffer, { format: uxp.storage.formats.binary });
    }

    return { success: true };
  } catch (e: any) {
    console.error("saveFrameBatch failed:", e);
    return { success: false, error: e?.message || "Failed to save frames" };
  }
};

export const encodeProRes = async (..._args: unknown[]) => ({success:false,error:"Use the reviewed Premiere CEP panel to encode caption clips."});

export const getOutputFolder = async (
  subfolderName?: string,
): Promise<{ success: boolean; path?: string; error?: string }> => {
  try {
    const project = await premierepro.Project.getActiveProject();
    const projectPath = project.path;
    const projectDir = projectPath.replace(/\/[^/]+$/, "");
    const baseDir = `${projectDir}/Better Captions`;

    const fs = uxp.storage.localFileSystem;
    let baseFolder: any;
    try {
      baseFolder = await fs.getEntryWithUrl(`file:${baseDir}`);
    } catch {
      const parentFolder = await fs.getEntryWithUrl(`file:${projectDir}`);
      baseFolder = await parentFolder.createFolder("Better Captions");
    }

    if (subfolderName) {
      const subDir = `${baseDir}/${subfolderName}`;
      try {
        await fs.getEntryWithUrl(`file:${subDir}`);
      } catch {
        await baseFolder.createFolder(subfolderName);
      }
      return { success: true, path: subDir };
    }

    return { success: true, path: baseDir };
  } catch (e: any) {
    console.error("getOutputFolder failed:", e);
    return { success: false, error: e?.message || String(e) };
  }
};

export const importVideoFile = async (
  filePath: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const project = await premierepro.Project.getActiveProject();
    const root = await project.getRootItem();
    const imported = await project.importFiles([filePath], true, root);

    if (!imported) {
      return { success: false, error: "Import failed" };
    }

    return { success: true };
  } catch (e: any) {
    console.error("importVideoFile failed:", e);
    return { success: false, error: e?.message || String(e) };
  }
};

export const importImageSequence = async (
  folderPath: string,
  frameRate: number,
  baseName: string,
): Promise<{ success: boolean; error?: string }> => {
  try {
    const fs = uxp.storage.localFileSystem;
    const outputFolder = await fs.getEntryWithUrl(`file:${folderPath}`);
    const firstFrame = await outputFolder.getEntry(`${baseName}_000000.png`);
    const filePath = firstFrame.nativePath;

    console.log("importImageSequence - filePath:", filePath, "fps:", frameRate);

    const project = await premierepro.Project.getActiveProject();
    const root = await project.getRootItem();
    const imported = await project.importFiles([filePath], true, root, true);

    if (!imported) {
      return { success: false, error: "Import failed" };
    }

    try {
      const items = await root.getItems();
      const importedItem = items.find((item: any) => item.name.includes(baseName));

      if (importedItem) {
        const clipItem = premierepro.ClipProjectItem.cast(importedItem);
        const interpretation = await clipItem.getFootageInterpretation();
        interpretation.setFrameRate(frameRate);
        const action = clipItem.createSetFootageInterpretationAction(interpretation);
        await lockedTransaction(project, [action], "Set Caption Frame Rate");
        console.log("Set footage frame rate to:", frameRate);
      }
    } catch (fpsErr: any) {
      console.warn("Could not set frame rate interpretation:", fpsErr?.message);
    }

    return { success: true };
  } catch (e: any) {
    console.error("importImageSequence failed:", e);
    return { success: false, error: e?.message || String(e) };
  }
};
