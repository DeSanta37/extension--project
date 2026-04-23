// src/internal/endpoint-fingerprint.ts
import uid from "tiny-uid";
var createFingerprint = () => `uid::${uid(7)}`;

// src/internal/connection-args.ts
var isValidConnectionArgs = (args, requiredKeys = ["endpointName", "fingerprint"]) => typeof args === "object" && args !== null && requiredKeys.every((k) => k in args);
var encodeConnectionArgs = (args) => {
  if (!isValidConnectionArgs(args))
    throw new TypeError("Invalid connection args");
  return JSON.stringify(args);
};
var decodeConnectionArgs = (encodedArgs) => {
  try {
    const args = JSON.parse(encodedArgs);
    return isValidConnectionArgs(args) ? args : null;
  } catch (error) {
    return null;
  }
};

// src/internal/delivery-logger.ts
var createDeliveryLogger = () => {
  let logs = [];
  return {
    add: (...receipts) => {
      logs = [...logs, ...receipts];
    },
    remove: (message) => {
      logs = typeof message === "string" ? logs.filter((receipt) => receipt.message.transactionId !== message) : logs.filter((receipt) => !message.includes(receipt));
    },
    entries: () => logs
  };
};

// src/internal/port-message.ts
var PortMessage = class {
  static toBackground(port, message) {
    return port.postMessage(message);
  }
  static toExtensionContext(port, message) {
    return port.postMessage(message);
  }
};

export {
  createFingerprint,
  encodeConnectionArgs,
  decodeConnectionArgs,
  createDeliveryLogger,
  PortMessage
};
