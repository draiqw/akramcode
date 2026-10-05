export function areExperimentalFeaturesEnabled(): boolean {
	return process.env.AKRAMCODE_EXPERIMENTAL === "1";
}
