export interface GateState {
  status: "idle" | "error" | "success";
  message?: string;
}

export const initialGateState: GateState = { status: "idle" };
