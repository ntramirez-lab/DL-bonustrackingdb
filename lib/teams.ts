// CS team rosters. Salesforce has no field saying whether a CSM is dedicated
// or pooled, so membership lives here (confirmed with Natalia, 2026-10-02).
// Names must match the Salesforce User Name exactly (case-insensitive).
// Update this file when the team changes.

export type Team = "dedicated" | "pooled";

const ROSTER: Record<Team, string[]> = {
  dedicated: ["Anna Grouzdev", "Austin Leyba", "Sahil Saini", "Tiffany Figueroa"],
  pooled: [
    "Ashlie Aguilar",
    "Danny Rasmussen",
    "Guillermo Celta",
    "Jeremy Galvez",
    "Nestor Ramirez",
  ],
};

// People who show up in the data but never count toward a team's KPIs.
// Accounts attributed to them are surfaced as a data-cleanup list instead.
const NOT_COUNTED: Record<string, string[]> = {
  Leadership: ["Christopher Real", "Chris Real", "Miah Camacho", "Matt Cave"],
  Onboarding: ["Alvaro Jara", "Sebastian Hidalgo", "Adrian Cintas"],
  "No longer at DoorLoop": ["Jeremy Keillor"],
  "Shouldn't own accounts": ["Nicole Toledano"],
};

const key = (name: string) => name.trim().toLowerCase();
const TEAM_OF = new Map<string, Team>(
  (Object.entries(ROSTER) as [Team, string[]][]).flatMap(([team, names]) => names.map((n) => [key(n), team]))
);
const GROUP_OF = new Map<string, string>(
  Object.entries(NOT_COUNTED).flatMap(([group, names]) => names.map((n) => [key(n), group]))
);

export const TEAMS: { id: Team; label: string }[] = [
  { id: "dedicated", label: "Dedicated team" },
  { id: "pooled", label: "Pooled team" },
];

export const teamOf = (name: string): Team | null => TEAM_OF.get(key(name)) ?? null;

// Why a name isn't on a team: a known group, "Unassigned", or "Not on a team".
export function notCountedReason(name: string): string {
  if (name === "Unassigned") return "No CSM in this field";
  return GROUP_OF.get(key(name)) ?? "Not on a team roster";
}

export const rosterNames = (team: Team) => ROSTER[team];
