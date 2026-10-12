import { describe, expect, it } from "vitest";
import { findDangerousCommands } from "../src/core/dangerous-commands.ts";

describe("findDangerousCommands", () => {
	it.each([
		["rm file.txt", "rm"],
		["rm -rf build", "rm"],
		["cd x && /bin/rm -f a", "rm"],
		["\\rm a", "rm"],
		["sudo rm -rf /", "rm"],
		["find . -name '*.log' | xargs rm", "rm"],
		["git rm --cached a", "rm"],
		["rmdir empty", "rmdir"],
		["unlink a", "unlink"],
		["shred -u secret", "shred"],
		["find . -name '*.tmp' -delete", "find -delete"],
		["git push --force", "git push --force"],
		["git push -f origin main", "git push --force"],
		["git push --force-with-lease", "git push --force"],
		["git push origin +main", "git push --force"],
		["git -C repo push -uf origin x", "git push --force"],
		["git reset --hard HEAD~1", "git reset --hard"],
		["git clean -fd", "git clean"],
		["git checkout -- src/a.ts", "git checkout (discard changes)"],
		["git checkout .", "git checkout (discard changes)"],
		["git restore src/a.ts", "git restore"],
		["git branch -D feature", "git branch -D"],
		["git stash drop", "git stash drop/clear"],
		["sudo apt install x", "sudo"],
		["dd if=/dev/zero of=/dev/disk2", "dd"],
		["mkfs.ext4 /dev/sdb1", "mkfs"],
		["diskutil eraseDisk APFS X disk2", "diskutil erase"],
	])("asks for %s", (command, label) => {
		expect(findDangerousCommands(command)).toContain(label);
	});

	it.each([
		"ls -la",
		"git status",
		"git push origin main",
		"git push -u origin feature",
		"git push --follow-tags",
		"git checkout -b feature",
		"git checkout main",
		"git reset HEAD a.ts",
		"git clean -n",
		"git branch -d merged",
		"npm run format",
		"grep -r perform src",
		"cat docs/rm.txt.bak",
		"find . -name '*.ts'",
		"git stash list; echo done",
		"python3 -m http.server --dd",
	])("does not ask for %s", (command) => {
		expect(findDangerousCommands(command)).toEqual([]);
	});
});
