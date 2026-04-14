/**
 * Pyodide-based G-code Sender Service
 * Uses Pyodide to run Python logic for G-code sending with Web Serial API for serial port access
 */

declare global {
  interface Window {
    loadPyodide: any;
  }
}

let pyodide: any = null;
let isPyodideLoaded = false;
let isLoadingPyodide = false;
let loadPromise: Promise<any> | null = null;

// Python code for G-code sending logic
const PYTHON_CODE = `
import json
import time

class GCodeSender:
    def __init__(self):
        self.is_sending = False
        self.current_line = 0
        self.total_lines = 0
        self.last_error = None
    
    def clean_command(self, line):
        """Remove comments from G-code line"""
        return line.split(';')[0].strip()
    
    def should_continue(self, response):
        """Check if we should continue waiting for 'ok'"""
        if not response:
            return True
        
        response_lower = response.lower()
        
        # Break if "ok" received
        if "ok" in response_lower:
            return False
        
        # Continue on temperature reports or status updates
        # These are informational, keep waiting for "ok"
        return True
    
    def has_error(self, response):
        """Check if response contains an error"""
        if not response:
            return False
        return "error" in response.lower()
    
    def process_response(self, response):
        """Process response and return status"""
        if not response:
            return {"continue": True, "error": None}
        
        response_lower = response.lower()
        
        # "ok" mesajı geldi - başarılı
        if "ok" in response_lower:
            return {"continue": False, "error": None, "ok": True}
        
        # Hata durumu
        if "error" in response_lower:
            return {"continue": False, "error": response, "ok": False}
        
        # "busy: processing" veya "echo:busy" - işlem devam ediyor, beklemeye devam et
        if "busy" in response_lower or "processing" in response_lower:
            return {"continue": True, "error": None, "ok": False}
        
        # Position updates, temperature reports, status updates - bilgilendirme, "ok" bekle
        # Örnek: "X:149.20 Y:120.90 Z:10.00" veya "o:Bed Leveling ON"
        # Bunlar sadece bilgilendirme, "ok" beklemeden devam et
        return {"continue": True, "error": None, "ok": False}

sender = GCodeSender()
`;

/**
 * Initialize Pyodide
 */
async function initPyodide(): Promise<any> {
  if (pyodide) return pyodide;
  if (isLoadingPyodide && loadPromise) return loadPromise;

  isLoadingPyodide = true;
  loadPromise = (async () => {
    try {
      console.log('[PyodideGCodeSender] Loading Pyodide from CDN...');
      
      // Load Pyodide from CDN
      if (!window.loadPyodide) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/pyodide.js';
        document.head.appendChild(script);
        
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
        });
      }
      
      pyodide = await window.loadPyodide({
        indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.1/full/'
      });

      console.log('[PyodideGCodeSender] Running Python initialization code...');
      await pyodide.runPythonAsync(PYTHON_CODE);

      isPyodideLoaded = true;
      isLoadingPyodide = false;
      console.log('[PyodideGCodeSender] Pyodide initialized successfully');

      return pyodide;
    } catch (error) {
      isLoadingPyodide = false;
      console.error('[PyodideGCodeSender] Failed to initialize Pyodide:', error);
      throw error;
    }
  })();

  return loadPromise;
}

/**
 * Clean G-code command (remove comments)
 */
export async function cleanGCodeCommand(line: string): Promise<string> {
  await initPyodide();
  
  try {
    pyodide.globals.set('line', line);
    const result = pyodide.runPython('sender.clean_command(line)');
    return result;
  } catch (error) {
    console.error('[PyodideGCodeSender] Error cleaning command:', error);
    // Fallback to JavaScript
    return line.split(';')[0].trim();
  }
}

/**
 * Process response from CNC machine
 */
export async function processCNCResponse(response: string): Promise<{
  continue: boolean;
  error: string | null;
  ok: boolean;
}> {
  await initPyodide();
  
  // Debug: log the raw response
  console.log('[PyodideGCodeSender] Processing response:', JSON.stringify(response));
  
  try {
    pyodide.globals.set('response', response);
    const result = pyodide.runPython(`
import json
result = sender.process_response(response)
json.dumps(result)
    `);
    
    const parsed = JSON.parse(result);
    console.log('[PyodideGCodeSender] Parsed result:', parsed);
    
    return {
      continue: parsed.continue || false,
      error: parsed.error || null,
      ok: parsed.ok || false
    };
  } catch (error) {
    console.error('[PyodideGCodeSender] Error processing response:', error);
    // Fallback to JavaScript with more aggressive "ok" detection
    const responseLower = (response || '').toLowerCase().trim();
    const hasOk = responseLower.includes('ok');
    const hasError = responseLower.includes('error');
    
    console.log('[PyodideGCodeSender] Fallback - hasOk:', hasOk, 'hasError:', hasError, 'response:', responseLower);
    
    return {
      continue: !hasOk && !hasError,
      error: hasError ? response : null,
      ok: hasOk
    };
  }
}

/**
 * Check if response contains error
 */
export async function hasError(response: string): Promise<boolean> {
  await initPyodide();
  
  try {
    pyodide.globals.set('response', response);
    const result = pyodide.runPython('sender.has_error(response)');
    return result;
  } catch (error) {
    console.error('[PyodideGCodeSender] Error checking error:', error);
    return response.toLowerCase().includes('error');
  }
}

/**
 * Health check - is Pyodide loaded?
 */
export async function isReady(): Promise<boolean> {
  try {
    await initPyodide();
    return isPyodideLoaded;
  } catch {
    return false;
  }
}
