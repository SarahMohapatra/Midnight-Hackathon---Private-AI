// App-side re-export of the Midnight adapter so frontend imports stay tidy.
export {
  recordAuditOnMidnight,
  getAuditTrail,
  probeMidnightStatus,
  type MidnightStatus,
  type MidnightConnectivity,
  type RecordAuditParams,
} from "../../../prover/midnight";
