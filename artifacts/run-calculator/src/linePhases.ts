// Compatibility surface: the canonical line phase policy is shared with server
// operational read models. Keep this module so existing client imports continue
// to resolve without maintaining a second physical model.
export * from "@workspace/live-calc/linePhases";