/**
 * Web Serial API G-code Sender Service
 * Uses Web Serial API for serial port access with Python logic via Pyodide for response processing
 */

import { processCNCResponse, cleanGCodeCommand, isReady as isPyodideReady } from './pyodideGcodeSender';

export interface WebSerialPort {
  port: any; // SerialPort from Web Serial API
  info?: any;
}

export interface ConnectionStatus {
  connected: boolean;
  port: string | null;
  baudrate: number | null;
  sending: boolean;
  paused: boolean;
  current_line: number;
  total_lines: number;
  last_error: string | null;
}

export interface SerialLogEntry {
  timestamp: Date;
  type: 'sent' | 'received' | 'info' | 'error';
  message: string;
}

export class WebSerialGCodeSender {
  private serialPort: WebSerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private isSending = false;
  private shouldStop = false;
  private isPaused = false;
  private statusCallback: ((status: ConnectionStatus) => void) | null = null;
  private logCallback: ((log: SerialLogEntry) => void) | null = null;
  private readBuffer: string = '';
  private decoder: TextDecoder = new TextDecoder('utf-8', { fatal: false });

  /**
   * Check if Web Serial API is supported
   */
  static isSupported(): boolean {
    return 'serial' in navigator;
  }

  /**
   * Check if Web Serial API is supported (instance method)
   */
  isSupported(): boolean {
    return WebSerialGCodeSender.isSupported();
  }

  /**
   * List ports already authorized by the user (does NOT show a picker dialog).
   * Note: Web Serial cannot enumerate arbitrary system ports without user permission.
   */
  async listPorts(): Promise<WebSerialPort[]> {
    if (!WebSerialGCodeSender.isSupported()) {
      return [];
    }
    try {
      const ports = await (navigator as any).serial.getPorts();
      return (ports || []).map((port: any) => ({
        port,
        info: typeof port?.getInfo === 'function' ? port.getInfo() : undefined
      }));
    } catch (error) {
      console.warn('[WebSerialGCodeSender] getPorts failed:', error);
    return [];
    }
  }

  /**
   * Request port selection from user
   */
  async requestPort(): Promise<WebSerialPort> {
    if (!WebSerialGCodeSender.isSupported()) {
      throw new Error('Web Serial API is not supported in this browser');
    }

    try {
      const port = await (navigator as any).serial.requestPort();
      const info = typeof port?.getInfo === 'function' ? port.getInfo() : undefined;
      return { port, info };
    } catch (error: any) {
      if (error.name === 'NotFoundError') {
        throw new Error('No port selected');
      }
      throw new Error(`Failed to request port: ${error.message}`);
    }
  }

  /**
   * Get the currently connected port handle (if any).
   * Useful to keep the same port across UI open/close within a session.
   */
  getConnectedPort(): WebSerialPort | null {
    return this.serialPort;
  }


  /**
   * Connect to serial port
   */
  async connect(port: WebSerialPort, baudrate: number = 115200): Promise<void> {
    // If already connected to the same port and streams exist, keep the session alive.
    if (this.serialPort?.port === port.port && (this.reader || this.writer)) {
      return;
    }

    // If connected to a different port, disconnect first.
    if (this.serialPort && this.serialPort.port !== port.port) {
    await this.disconnect();
    }

    try {
      // Populate info if missing
      if (!port.info && typeof port?.port?.getInfo === 'function') {
        try {
          port.info = port.port.getInfo();
        } catch {
          // ignore
        }
      }

      // Open port with options
      const options: {
        baudRate: number;
        dataBits?: 7 | 8;
        stopBits?: 1 | 2;
        parity?: 'none' | 'even' | 'odd';
        bufferSize?: number;
        flowControl?: 'none' | 'hardware';
      } = {
        baudRate: baudrate,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        bufferSize: 255,
        flowControl: 'none'
      };

      // Only open if not already open
      if (!port.port.readable && !port.port.writable) {
      await port.port.open(options);
      }
      
      // ⚡ ALWAYS get fresh readers/writers when connecting
      // This ensures we don't have stale/blocked streams from previous stop
      if (!this.reader && port.port.readable) {
        this.reader = port.port.readable.getReader();
      }
      if (!this.writer && port.port.writable) {
        this.writer = port.port.writable.getWriter();
      }

      if (!this.reader || !this.writer) {
        throw new Error('Failed to get serial port streams');
      }

      this.serialPort = port;
      
      this.addLog('info', `Connected at ${baudrate} baud - waiting for printer reset...`);
      
      // Wait a bit for printer reset
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      this.addLog('info', 'Ready to send G-code');
      
    } catch (error: any) {
      // Clean up on error
      try {
        await this.disconnect();
      } catch (cleanupError) {
        console.error('[WebSerialGCodeSender] Cleanup error:', cleanupError);
      }

      // Provide more specific error messages
      let errorMessage = 'Connection failed';
      
      if (error.name === 'NetworkError') {
        errorMessage = 'Port is already in use by another application. Please close other programs using this port.';
      } else if (error.name === 'InvalidStateError') {
        errorMessage = 'Port is already open. Please try disconnecting and reconnecting.';
      } else if (error.message) {
        errorMessage = `Connection failed: ${error.message}`;
      } else if (error.toString) {
        errorMessage = `Connection failed: ${error.toString()}`;
      }

      throw new Error(errorMessage);
    }
  }

  /**
   * Disconnect from serial port
   */
  async disconnect(): Promise<void> {
    this.shouldStop = true;
    this.isSending = false;

    try {
      // Release reader
      if (this.reader) {
        try {
          await this.reader.cancel();
        } catch (e) {
          // Ignore cancel errors
        }
        try {
          await this.reader.releaseLock();
        } catch (e) {
          // Ignore release errors
        }
        this.reader = null;
      }

      // Clear read buffer
      this.readBuffer = '';

      // Release writer
      if (this.writer) {
        try {
          await this.writer.releaseLock();
        } catch (e) {
          // Ignore release errors
        }
        this.writer = null;
      }

      // Close port
      if (this.serialPort) {
        try {
          // Check if port is open before closing
          if (this.serialPort.port.readable || this.serialPort.port.writable) {
            await this.serialPort.port.close();
          }
        } catch (e) {
          // Port might already be closed, ignore
          console.warn('[WebSerialGCodeSender] Port close warning:', e);
        }
        this.serialPort = null;
      }
    } catch (error) {
      console.error('[WebSerialGCodeSender] Error during disconnect:', error);
      // Don't throw - we want to clean up as much as possible
    }
  }


  /**
   * Read line from serial port (blocking, for command-response pattern)
   * Mimics Python's readline() behavior - reads until newline character
   */
  private async readLine(timeout: number = 5000): Promise<string | null> {
    if (!this.reader) {
      throw new Error('Not connected');
    }

    const startTime = Date.now();
    let lastReadTime = Date.now();

    // Check if we already have a complete line in buffer
    const existingNewlineIndex = this.readBuffer.indexOf('\n');
    if (existingNewlineIndex !== -1) {
      const line = this.readBuffer.substring(0, existingNewlineIndex);
      this.readBuffer = this.readBuffer.substring(existingNewlineIndex + 1);
      const trimmedLine = line.replace(/\r\n?$/, '').trim(); // Remove \r and \n, then trim
      if (trimmedLine.length > 0) {
        this.addLog('received', trimmedLine);
        return trimmedLine;
      }
    }

    // Read until we get a complete line (Python readline() behavior)
    while (Date.now() - startTime < timeout) {
      // Check stop flag frequently
      if (this.shouldStop) {
        this.addLog('info', 'Read interrupted by stop request');
        return null;
      }

      // If no data received for a while, check if buffer has content
      if (Date.now() - lastReadTime > 50 && this.readBuffer.length > 0) {
        // Process buffer even if no newline yet
        const newlineIndex = this.readBuffer.indexOf('\n');
        if (newlineIndex !== -1) {
          const line = this.readBuffer.substring(0, newlineIndex);
          this.readBuffer = this.readBuffer.substring(newlineIndex + 1);
          const trimmedLine = line.replace(/\r\n?$/, '').trim();
          if (trimmedLine.length > 0) {
            this.addLog('received', trimmedLine);
            return trimmedLine;
          }
        }
      }

      try {
        // Check stop before read
        if (this.shouldStop) {
          return null;
        }
        
        const { done, value } = await this.reader.read();

        // Check stop after read
        if (this.shouldStop) {
          return null;
        }

        if (done) {
          // Stream ended - process remaining buffer
          if (this.readBuffer.trim().length > 0) {
            const line = this.readBuffer.trim();
            this.readBuffer = '';
            if (line.length > 0) {
              this.addLog('received', line);
              return line;
            }
          }
          return null;
        }

        if (value) {
          lastReadTime = Date.now();
          
          // Decode with error handling (like Python's errors='ignore')
          try {
            this.readBuffer += this.decoder.decode(value, { stream: true });
          } catch (decodeError) {
            // Ignore decode errors, continue reading
            console.warn('[WebSerialGCodeSender] Decode error (ignored):', decodeError);
          }
          
          // Check for newline in buffer (handle both \n and \r\n)
          const newlineIndex = this.readBuffer.indexOf('\n');
          if (newlineIndex !== -1) {
            const line = this.readBuffer.substring(0, newlineIndex);
            this.readBuffer = this.readBuffer.substring(newlineIndex + 1);
            
            // Remove \r if present (handle \r\n)
            const trimmedLine = line.replace(/\r$/, '').trim();
            
            if (trimmedLine.length > 0) {
              this.addLog('received', trimmedLine);
              return trimmedLine;
            }
            // Empty line, continue reading
          }
        }
      } catch (error: any) {
        if (error.name !== 'NetworkError' && !this.shouldStop) {
          console.error('[WebSerialGCodeSender] Read error:', error);
        }
        // If buffer has content, try to return it
        if (this.readBuffer.trim().length > 0) {
          const line = this.readBuffer.trim();
          this.readBuffer = '';
          if (line.length > 0) {
            this.addLog('received', line);
            return line;
          }
        }
        return null;
      }
    }

    // Timeout - check if we have partial data in buffer
    if (this.readBuffer.trim().length > 0) {
      const line = this.readBuffer.trim();
      this.readBuffer = '';
      if (line.length > 0) {
        this.addLog('received', line);
        return line;
      }
    }

    return null; // Timeout with no data
  }

  /**
   * Write data to serial port
   */
  private async write(data: Uint8Array): Promise<void> {
    if (!this.writer) {
      throw new Error('Not connected');
    }

    try {
      await this.writer.write(data);
    } catch (error) {
      throw new Error(`Write failed: ${error}`);
    }
  }


  /**
   * Send G-code lines
   */
  async sendGCode(gcodeLines: string[]): Promise<void> {
    if (!this.serialPort) {
      throw new Error('Not connected');
    }

    if (this.isSending) {
      throw new Error('Already sending');
    }

    this.isSending = true;
    this.shouldStop = false;
    this.isPaused = false;
    
    // CRITICAL: Clear read buffer at start to prevent stale data from previous send
    this.readBuffer = '';

    try {
      // Clean G-code lines
      const cleanedLines: string[] = [];
      for (const line of gcodeLines) {
        if (this.shouldStop) {
          break;
        }
        const cleaned = await cleanGCodeCommand(line);
        if (cleaned.length > 0) {
          cleanedLines.push(cleaned);
        }
      }

      // Check if stopped during cleaning
      if (this.shouldStop) {
        this.addLog('info', 'Stopped by user (during cleaning)');
        throw new Error('Stopped by user');
      }

      if (cleanedLines.length === 0) {
        throw new Error('No G-code lines to send');
      }

      const totalLines = cleanedLines.length;
      let sentIndex = 0;
      let ackIndex = 0;
      const encoder = new TextEncoder();
      const minBufferLines = 3; // Maintain at least 3 lines for smooth motion
      const maxBufferLines = 4; // Try to keep 4 lines max (conservative for 128 byte RX buffer)
      // RX buffer is 128 bytes. With accurate byte tracking, we can be more aggressive.
      // Average line: ~35 bytes
      // 3 lines × 35 = 105 bytes (SAFE)
      // But we must leave margin for firmware processing
      const maxBufferBytes = 115; // Conservative limit (13 byte margin from 128)
      
      // Track actual bytes in firmware buffer (critical for preventing partial lines!)
      const sentLineBytes: number[] = []; // Track size of each sent line

      this.updateStatus({
        connected: true,
        port: (this.serialPort.info as any)?.usbVendorId?.toString() || 'unknown',
        baudrate: 115200,
        sending: true,
        paused: false,
        current_line: 0,
        total_lines: totalLines,
        last_error: null
      });

      // Ensure Pyodide is ready
      await isPyodideReady();

      // Phase 1: Send initial buffer (fill to minBufferLines or maxBufferBytes, whichever comes first)
      let totalBytesInBuffer = 0;
      
      while (sentIndex < totalLines && sentIndex < maxBufferLines) {
        if (this.shouldStop) break;
        const line = cleanedLines[sentIndex];
        const lineBytes = line.length + 1;
        const linesRemaining = totalLines - sentIndex;
        
        // Stop if would overflow, but ensure at least minBufferLines (3)
        if (totalBytesInBuffer + lineBytes > maxBufferBytes) {
          // Always send if it's one of the last 3 lines (ensure completion)
          if (linesRemaining <= 3) {
            this.addLog('sent', `${line} (initial final: ${sentIndex+1})`);
          } else if (sentIndex >= minBufferLines) {
            break; // We have minimum, stop to prevent overflow
          } else {
            // Continue to reach minimum (starvation prevention priority)
            this.addLog('sent', `${line} (initial: ${sentIndex+1})`);
          }
        } else {
          this.addLog('sent', `${line} (initial: ${sentIndex+1})`);
        }
        
        await this.write(encoder.encode(line + '\n'));
        sentLineBytes.push(lineBytes);
        totalBytesInBuffer += lineBytes;
        sentIndex++;
      }
      
      // Delay after initial batch to let firmware start processing
      // (Firmware needs time to receive and queue commands at 115200 baud)
      await new Promise(resolve => setTimeout(resolve, 100));

      // Phase 2: Streaming mode - maintain constant buffer depth (keeps ~4 lines in firmware buffer)
      while (ackIndex < totalLines) {
        // Check stop flag
        if (this.shouldStop) {
          this.addLog('info', 'Stopped by user');
          break;
        }

        // Wait if paused
        while (this.isPaused && !this.shouldStop) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (this.shouldStop) {
          this.addLog('info', 'Stopped by user');
          break;
        }

        // Wait for "ok" response
        let okReceived = false;
        let errorReceived: string | null = null;
        const startTime = Date.now();
        const commandTimeout = 60000; // 60s timeout (for blocking commands like G28)
        
        // Use longer timeout for first response and be more patient at 115200 baud
        const readTimeout = ackIndex === 0 ? 1000 : 200; // 1s for first, 200ms for rest

        while (!okReceived && !errorReceived && !this.shouldStop) {
          // Check timeout
          if (Date.now() - startTime > commandTimeout) {
            throw new Error(`Timeout waiting for response (line ${ackIndex + 1})`);
          }

          const response = await this.readLine(readTimeout);
          if (!response) continue; // No response yet, keep waiting

          const processed = await processCNCResponse(response);
          if (processed.ok) {
            okReceived = true;
          } else if (processed.error) {
            errorReceived = processed.error;
            break;
          }
          // else: continue (busy/echo messages)
        }

            if (this.shouldStop) {
              this.addLog('info', 'Stopped by user');
              break;
            }

        if (errorReceived) {
            this.updateStatus({
              connected: true,
              port: (this.serialPort.info as any)?.usbVendorId?.toString() || 'unknown',
              baudrate: 115200,
              sending: false,
              paused: false,
            current_line: ackIndex,
              total_lines: totalLines,
            last_error: errorReceived
            });
          throw new Error(`Printer error: ${errorReceived}`);
        }

        // Got "ok", acknowledge this line
        const acknowledgedBytes = sentLineBytes.shift() || 0;
        totalBytesInBuffer -= acknowledgedBytes; // Remove from buffer tracking
        ackIndex++;

        // Refill strategy: Add lines until buffer reaches maxBufferLines or maxBufferBytes
        // Priority: Maintain minBufferLines (3) to prevent starvation
        
        while (sentIndex < totalLines) {
          const linesInBuffer = sentIndex - ackIndex;
          const nextLine = cleanedLines[sentIndex];
          const lineBytes = nextLine.length + 1;
          const linesRemaining = totalLines - sentIndex;
          
          // Stop if reached max lines (but allow finishing last few lines)
          if (linesInBuffer >= maxBufferLines && linesRemaining > 3) break;
          
          // Check byte limit
          const wouldOverflow = (totalBytesInBuffer + lineBytes > maxBufferBytes);
          
          if (wouldOverflow) {
            // CRITICAL: Always send last 3 lines regardless of byte limit
            if (linesRemaining <= 3) {
              this.addLog('sent', `${nextLine} (final)`);
            } else if (linesInBuffer >= minBufferLines) {
              // Buffer has minimum, stop to prevent overflow
              break;
            } else {
              // Continue (starvation prevention)
              this.addLog('sent', nextLine);
            }
          } else {
            this.addLog('sent', nextLine);
          }
          
          await this.write(encoder.encode(nextLine + '\n'));
          sentLineBytes.push(lineBytes);
          totalBytesInBuffer += lineBytes;
          sentIndex++;
        }

        // Update progress
          this.updateStatus({
            connected: true,
            port: (this.serialPort.info as any)?.usbVendorId?.toString() || 'unknown',
            baudrate: 115200,
            sending: true,
            paused: this.isPaused,
          current_line: ackIndex,
            total_lines: totalLines,
            last_error: null
          });
      }

      // Log completion status
      if (ackIndex === totalLines && sentIndex === totalLines) {
        this.addLog('info', `✅ SUCCESS: All ${totalLines} lines sent and acknowledged`);
      } else {
        if (sentIndex < totalLines) {
          const missing = totalLines - sentIndex;
          this.addLog('error', `⚠️ INCOMPLETE: ${missing} lines NOT SENT (${sentIndex}/${totalLines})`);
        }
        if (ackIndex < sentIndex) {
          const missing = sentIndex - ackIndex;
          this.addLog('error', `⚠️ INCOMPLETE: ${missing} lines sent but NOT ACKNOWLEDGED (${ackIndex}/${sentIndex})`);
        }
        this.addLog('info', `📊 Final: Sent ${sentIndex}/${totalLines}, Acknowledged ${ackIndex}/${totalLines}`);
      }

      this.updateStatus({
        connected: true,
        port: (this.serialPort.info as any)?.usbVendorId?.toString() || 'unknown',
        baudrate: 115200,
        sending: false,
        paused: false,
        current_line: ackIndex,
        total_lines: totalLines,
        last_error: this.shouldStop ? 'Stopped by user' : null
      });

    } finally {
      this.isSending = false;
      // Clear read buffer to prevent stale data affecting next send
      this.readBuffer = '';
    }
  }

  /**
   * Stop sending
   */
  async stopSending(): Promise<void> {
    this.shouldStop = true;
    this.isSending = false;
    this.isPaused = false;
    this.addLog('info', 'Stop requested by user');
    
    // ⚡ CRITICAL FIX: Release reader/writer so next send can work
    // Port stays open, but streams are reset to prevent blocking
    try {
      if (this.reader) {
        try {
          await this.reader.cancel();
        } catch (e) {
          // Ignore - reader might already be cancelled
        }
        try {
          this.reader.releaseLock();
        } catch (e) {
          // Ignore - lock might already be released
        }
        this.reader = null;
      }
      
      if (this.writer) {
        try {
          this.writer.releaseLock();
        } catch (e) {
          // Ignore - lock might already be released
        }
        this.writer = null;
      }
      
      this.readBuffer = '';
      this.addLog('info', 'Streams released - ready for next send');
    } catch (error) {
      console.warn('[WebSerialGCodeSender] Error releasing streams:', error);
    }
    
    // Update status immediately
    const currentStatus = this.getStatus();
    this.updateStatus({
      ...currentStatus,
      sending: false,
      paused: false,
      last_error: 'Stopped by user'
    });
  }

  /**
   * Pause sending
   */
  async pauseSending(): Promise<void> {
    if (!this.isSending) {
      return;
    }
    this.isPaused = true;
    this.addLog('info', 'Paused by user');
    
    const currentStatus = this.getStatus();
    this.updateStatus({
      ...currentStatus,
      paused: true
    });
  }

  /**
   * Resume sending
   */
  async resumeSending(): Promise<void> {
    if (!this.isSending || !this.isPaused) {
      return;
    }
    this.isPaused = false;
    this.addLog('info', 'Resumed by user');
    
    const currentStatus = this.getStatus();
    this.updateStatus({
      ...currentStatus,
      paused: false
    });
  }

  /**
   * Get status
   */
  getStatus(): ConnectionStatus {
    const isOpen = !!this.serialPort && (!!this.serialPort.port?.readable || !!this.serialPort.port?.writable);
    return {
      connected: isOpen,
      port: this.serialPort ? ((this.serialPort.info as any)?.usbVendorId?.toString() || 'connected') : null,
      baudrate: 115200,
      sending: this.isSending,
      paused: this.isPaused,
      current_line: 0,
      total_lines: 0,
      last_error: null
    };
  }

  /**
   * Set status callback
   */
  setStatusCallback(callback: (status: ConnectionStatus) => void): void {
    this.statusCallback = callback;
  }

  /**
   * Set log callback
   */
  setLogCallback(callback: (log: SerialLogEntry) => void): void {
    this.logCallback = callback;
  }

  /**
   * Add log entry
   */
  private addLog(type: SerialLogEntry['type'], message: string): void {
    if (this.logCallback) {
      this.logCallback({
        timestamp: new Date(),
        type,
        message
      });
    }
  }

  /**
   * Update status
   */
  private updateStatus(status: ConnectionStatus): void {
    if (this.statusCallback) {
      this.statusCallback(status);
    }
  }
}

// Export singleton instance
export const webSerialGCodeSender = new WebSerialGCodeSender();
