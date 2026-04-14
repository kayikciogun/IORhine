import { debug } from '../../Utils/debug';

/**
 * DWG to DXF Converter using LibreDWG WASM
 * Converts DWG files to DXF format for CAD operations
 */

let libredwgInstance: any = null;

/**
 * Initialize LibreDWG WASM module
 */
async function initLibreDWG() {
  try {
    // Always create a fresh instance to avoid state issues
    debug.log('[DWG Converter] Creating fresh LibreDWG WASM instance...');
    
    // Check if we're in a browser environment
    if (typeof window === 'undefined') {
      throw new Error('LibreDWG WASM can only be used in browser environment');
    }
    
    // Load WASM module using dynamic import to handle ES modules properly
    const moduleUrl = '/libredwg/libredwgread.mjs';
    
    // Use dynamic import to load the ES module
    const module = await import(/* webpackIgnore: true */ moduleUrl);
    const createModule = module.default || module;
    
    // Capture LibreDWG output for debugging
    let stdoutBuffer = '';
    let stderrBuffer = '';
    
    const freshInstance = await createModule({
      noInitialRun: true,
      locateFile: (path: string) => {
        // Load WASM files from public directory
        if (path.endsWith('.wasm')) {
          return `/libredwg/${path}`;
        }
        return path;
      },
      printErr: (text: string) => {
        stderrBuffer += text + '\n';
        //debug.warn('[LibreDWG stderr]', text);
      },
      print: (text: string) => {
        stdoutBuffer += text + '\n';
       // debug.log('[LibreDWG stdout]', text);
      }
    });

    // Store output buffers for debugging
    (freshInstance as any)._stdoutBuffer = () => stdoutBuffer;
    (freshInstance as any)._stderrBuffer = () => stderrBuffer;
    (freshInstance as any)._clearBuffers = () => {
      stdoutBuffer = '';
      stderrBuffer = '';
    };

    // Reset filesystem to clean state
    try {
      // Clear any existing files in the filesystem
      const files = freshInstance.FS.readdir('/');
      files.forEach((file: string) => {
        if (file !== '.' && file !== '..' && file !== 'dev' && file !== 'proc') {
          try {
            const stat = freshInstance.FS.stat('/' + file);
            if (freshInstance.FS.isFile(stat.mode)) {
              freshInstance.FS.unlink('/' + file);
            }
          } catch (e) {
            // Ignore cleanup errors
          }
        }
      });
    } catch (cleanupError) {
      debug.warn('[DWG Converter] Filesystem cleanup warning:', cleanupError);
    }

    debug.log('[DWG Converter] Fresh LibreDWG WASM instance created successfully');
    return freshInstance;
  } catch (error) {
    console.error('[DWG Converter] Failed to initialize LibreDWG:', error);
    throw new Error('LibreDWG initialization failed: ' + (error as Error).message);
  }
}

/**
 * Convert DWG file buffer to DXF string
 * @param dwgBuffer - DWG file content
 * @param fileName - Original file name (for logging)
 * @returns DXF content as string
 */
export async function convertDwgToDxf(dwgBuffer: ArrayBuffer, fileName: string = 'file.dwg'): Promise<string> {
  let instance: any = null;
  
  try {
    debug.log(`[DWG Converter] Starting conversion of ${fileName} (${dwgBuffer.byteLength} bytes)`);
    
    // Validate input
    if (!dwgBuffer || dwgBuffer.byteLength === 0) {
      throw new Error('DWG buffer is empty or invalid');
    }

    // Check if it's actually a DWG file
    if (!isDwgFile(dwgBuffer)) {
      throw new Error('File does not appear to be a valid DWG file');
    }

    const dwgVersion = getDwgVersion(dwgBuffer);
    debug.log(`[DWG Converter] Detected DWG version: ${dwgVersion}`);
    
    // Always get a fresh instance for each conversion
    instance = await initLibreDWG();
    
    // Clear previous output buffers
    instance._clearBuffers();
    
    // Write DWG file to WASM filesystem
    const inputFileName = 'input.dwg';
    const outputFileName = 'output.dxf';
    
    debug.log(`[DWG Converter] Writing ${dwgBuffer.byteLength} bytes to WASM filesystem as ${inputFileName}`);
    const uint8Array = new Uint8Array(dwgBuffer);
    instance.FS.writeFile(inputFileName, uint8Array);
    
    // Verify file was written correctly
    const writtenFile = instance.FS.readFile(inputFileName);
    if (writtenFile.length !== uint8Array.length) {
      throw new Error(`File write verification failed: expected ${uint8Array.length} bytes, got ${writtenFile.length}`);
    }
    
    debug.log('[DWG Converter] File written successfully, starting conversion...');
    
    // Prepare arguments for dwgread
    const args = [
      'dwgread',
      '-O', 'DXF',
      '-o', outputFileName,
      inputFileName
    ];
    
    debug.log('[DWG Converter] Executing dwgread with args:', args);
    
    // Set up main function arguments
    const mainArgs = makeMainArgs(instance, args);
    
    // Call the main function
    const exitCode = instance._main(mainArgs.argc, mainArgs.argv);
    
    debug.log(`[DWG Converter] dwgread completed with exit code: ${exitCode}`);
    
    // Get output for debugging
    const stdout = instance._stdoutBuffer();
    const stderr = instance._stderrBuffer();
    
    if (stdout) {
      debug.log('[DWG Converter] stdout:', stdout);
    }
    if (stderr) {
      debug.log('[DWG Converter] stderr:', stderr);
    }
    
    // Check if conversion was successful
    if (exitCode !== 0) {
      throw new Error(`DWG conversion failed with exit code ${exitCode}. stderr: ${stderr}`);
    }
    
    // Check if output file exists
    let outputExists = false;
    try {
      instance.FS.stat(outputFileName);
      outputExists = true;
    } catch (e) {
      outputExists = false;
    }
    
    if (!outputExists) {
      throw new Error(`Output file ${outputFileName} was not created. Conversion may have failed.`);
    }
    
    // Read the converted DXF file
    debug.log('[DWG Converter] Reading converted DXF file...');
    const dxfData = instance.FS.readFile(outputFileName, { encoding: 'utf8' });
    
    if (!dxfData || dxfData.length === 0) {
      throw new Error('Converted DXF file is empty');
    }
    
    debug.log(`[DWG Converter] Conversion successful! DXF size: ${dxfData.length} characters`);
    
    // Clean up files
    try {
      instance.FS.unlink(inputFileName);
      instance.FS.unlink(outputFileName);
    } catch (cleanupError) {
      debug.warn('[DWG Converter] Cleanup warning:', cleanupError);
    }
    
    return dxfData;
    
  } catch (error) {
    console.error('[DWG Converter] Conversion error:', error);
    
    // Try to get more debug info if instance exists
    if (instance) {
      try {
        const stdout = instance._stdoutBuffer();
        const stderr = instance._stderrBuffer();
        console.error('[DWG Converter] Debug stdout:', stdout);
        console.error('[DWG Converter] Debug stderr:', stderr);
      } catch (debugError) {
        console.error('[DWG Converter] Could not get debug info:', debugError);
      }
    }
    
    throw error;
  }
}

/**
 * Helper function to set up main function arguments
 */
function makeMainArgs(instance: any, argArray: string[]) {
  const argc = argArray.length;
  const argv = instance._malloc(argc * 4); // 4 bytes per pointer
  
  for (let i = 0; i < argc; i++) {
    // Use stringToNewUTF8 instead of allocateUTF8
    const argStr = instance.stringToNewUTF8 ? 
      instance.stringToNewUTF8(argArray[i]) : 
      instance._malloc(argArray[i].length + 1);
    
    // If stringToNewUTF8 is not available, manually copy string
    if (!instance.stringToNewUTF8) {
      instance.stringToUTF8(argArray[i], argStr, argArray[i].length + 1);
    }
    
    instance.setValue(argv + i * 4, argStr, 'i32');
  }
  
  return { argc, argv };
}

/**
 * Check if buffer contains a DWG file
 */
export function isDwgFile(buffer: ArrayBuffer): boolean {
  if (!buffer || buffer.byteLength < 6) {
    return false;
  }
  
  const view = new DataView(buffer);
  
  // Check for DWG signature
  // DWG files typically start with "AC" followed by version info
  const firstByte = view.getUint8(0);
  const secondByte = view.getUint8(1);
  
  if (firstByte === 0x41 && secondByte === 0x43) { // "AC"
    return true;
  }
  
  // Some DWG files might have different signatures
  // Check for other known DWG patterns
  const signature = new Uint8Array(buffer, 0, Math.min(6, buffer.byteLength));
  const signatureStr = Array.from(signature).map(b => String.fromCharCode(b)).join('');
  
  // Common DWG version signatures
  const dwgSignatures = [
    'AC1014', // AutoCAD R14
    'AC1015', // AutoCAD 2000
    'AC1018', // AutoCAD 2004
    'AC1021', // AutoCAD 2007
    'AC1024', // AutoCAD 2010
    'AC1027', // AutoCAD 2013
    'AC1032'  // AutoCAD 2018
  ];
  
  return dwgSignatures.some(sig => signatureStr.startsWith(sig));
}

/**
 * Get DWG version from buffer
 */
export function getDwgVersion(buffer: ArrayBuffer): string {
  if (!buffer || buffer.byteLength < 6) {
    return 'Unknown';
  }
  
  const signature = new Uint8Array(buffer, 0, 6);
  const signatureStr = Array.from(signature).map(b => String.fromCharCode(b)).join('');
  
  // Map version codes to readable names
  const versionMap: { [key: string]: string } = {
    'AC1014': 'AutoCAD R14',
    'AC1015': 'AutoCAD 2000',
    'AC1018': 'AutoCAD 2004',
    'AC1021': 'AutoCAD 2007',
    'AC1024': 'AutoCAD 2010',
    'AC1027': 'AutoCAD 2013',
    'AC1032': 'AutoCAD 2018'
  };
  
  for (const [code, name] of Object.entries(versionMap)) {
    if (signatureStr.startsWith(code)) {
      return name;
    }
  }
  
  return `Unknown (${signatureStr})`;
}

/**
 * Get DWG file information
 */
export function getDwgInfo(buffer: ArrayBuffer): { version: string; size: number; isValid: boolean } {
  return {
    version: getDwgVersion(buffer),
    size: buffer.byteLength,
    isValid: isDwgFile(buffer)
  };
}

export default {
  convertDwgToDxf,
  isDwgFile,
  getDwgVersion,
  getDwgInfo
};