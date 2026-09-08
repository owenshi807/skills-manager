import { Navigate } from "react-router-dom";

/** Compatibility entry: combinations now live inside usage scenes. */
export function Decks() {
  return <Navigate replace to="/scenes" />;
}
