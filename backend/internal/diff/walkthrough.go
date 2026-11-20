package diff

import (
	"fmt"
	"path"
	"sort"
	"strings"
)

// Walkthrough is the deterministic review path: an ordered, exhaustive
// partition of a pull request's changed hunks into commit-sized steps. It is a
// navigation aid, not a verdict; every changed hunk belongs to exactly one
// step, and files without renderable hunks still appear in the mechanical step.
type Walkthrough struct {
	Steps []WalkthroughStep `json:"steps"`
}

// WalkthroughStep is one synthetic commit. Hunks indexes into the owning
// file's Hunk slice; an empty slice means the file has nothing to render
// (binary or an empty patch). Files stay in first-appearance order.
type WalkthroughStep struct {
	ID        string            `json:"id"`
	Title     string            `json:"title"`
	Files     []WalkthroughFile `json:"files"`
	Additions int               `json:"additions"`
	Deletions int               `json:"deletions"`
}

// WalkthroughFile names one file in a step. OldPath is set when the pull
// request renamed the file.
type WalkthroughFile struct {
	Path    string `json:"path"`
	OldPath string `json:"oldPath,omitempty"`
	Hunks   []int  `json:"hunks"`
}

const (
	// walkthroughMaxSourceSteps keeps a large pull request from becoming a
	// forty-item sidebar. Moves, tests and mechanical changes stay separate.
	walkthroughMaxSourceSteps = 9
	// moveSimilarity is the share of runes two entity bodies must share before
	// a deletion and an addition in different files count as a move. Name and
	// entity type already have to match.
	moveSimilarity = 0.5
)

// walkthroughUnit is one assignable piece of the diff. hunk is -1 for a file
// with no renderable hunks so binary files still appear in the path.
type walkthroughUnit struct {
	file int
	hunk int
}

type walkthroughGroup struct {
	title string
	units []walkthroughUnit
}

type changeRef struct {
	file   int
	change int
}

// BuildWalkthrough partitions files into a review path. It never returns nil
// for a non-empty diff, and it does not depend on sem: without semantic
// changes every file becomes its own step, ordered by the focus score.
func BuildWalkthrough(files []File) *Walkthrough {
	if len(files) == 0 {
		return nil
	}

	assigned := make(map[walkthroughUnit]bool)
	steps := make([]WalkthroughStep, 0, len(files))

	for _, group := range buildMoveGroups(files) {
		units := make([]walkthroughUnit, 0, len(group.units))
		for _, unit := range group.units {
			if assigned[unit] {
				continue
			}
			assigned[unit] = true
			units = append(units, unit)
		}
		if len(units) == 0 {
			continue
		}
		steps = append(steps, newWalkthroughStep(len(steps), files, units, group.title))
	}

	source := make([]walkthroughGroup, 0, len(files))
	var tests []walkthroughUnit
	var mechanical []walkthroughUnit

	for index := range files {
		units := remainingUnits(files, index, assigned)
		if len(units) == 0 {
			continue
		}
		switch walkthroughCategory(files[index]) {
		case "test":
			tests = append(tests, units...)
		case "mechanical":
			mechanical = append(mechanical, units...)
		default:
			source = append(source, walkthroughGroup{
				title: walkthroughFileTitle(files[index]),
				units: units,
			})
		}
	}

	sort.SliceStable(source, func(a, b int) bool {
		left, right := files[source[a].units[0].file], files[source[b].units[0].file]
		if score(left) != score(right) {
			return score(left) > score(right)
		}
		return left.Path < right.Path
	})

	if len(source) > walkthroughMaxSourceSteps {
		keep := walkthroughMaxSourceSteps - 1
		merged := make([]walkthroughUnit, 0)
		for _, group := range source[keep:] {
			merged = append(merged, group.units...)
		}
		source = append(source[:keep], walkthroughGroup{
			title: "Other source changes",
			units: merged,
		})
	}

	for _, group := range source {
		steps = append(steps, newWalkthroughStep(len(steps), files, group.units, group.title))
	}
	if len(tests) > 0 {
		steps = append(steps, newWalkthroughStep(len(steps), files, tests, "Update tests"))
	}
	if len(mechanical) > 0 {
		steps = append(steps, newWalkthroughStep(len(steps), files, mechanical, "Mechanical changes"))
	}

	return &Walkthrough{Steps: steps}
}

func score(file File) int {
	if file.Review == nil {
		return 0
	}
	return file.Review.Score
}

// remainingUnits lists the hunks of one file that no move or rename group has
// claimed. A file without hunks is one unit so it can still be listed.
func remainingUnits(files []File, index int, assigned map[walkthroughUnit]bool) []walkthroughUnit {
	file := files[index]
	if len(file.Hunks) == 0 {
		unit := walkthroughUnit{file: index, hunk: -1}
		if assigned[unit] {
			return nil
		}
		return []walkthroughUnit{unit}
	}
	units := make([]walkthroughUnit, 0, len(file.Hunks))
	for hunk := range file.Hunks {
		unit := walkthroughUnit{file: index, hunk: hunk}
		if !assigned[unit] {
			units = append(units, unit)
		}
	}
	return units
}

func walkthroughCategory(file File) string {
	if file.Binary ||
		len(file.Hunks) == 0 ||
		walkthroughCosmeticOnly(file) ||
		contains(file.Kinds, KindGenerated) ||
		contains(file.Kinds, KindDocs) {
		return "mechanical"
	}
	if contains(file.Kinds, KindTest) {
		return "test"
	}
	return "source"
}

func walkthroughCosmeticOnly(file File) bool {
	if len(file.Semantic) == 0 {
		return false
	}
	for _, change := range file.Semantic {
		if !change.Cosmetic {
			return false
		}
	}
	return true
}

// newWalkthroughStep folds units into one step. Files keep first-appearance
// order; hunks are sorted so a move group reads in patch order.
func newWalkthroughStep(index int, files []File, units []walkthroughUnit, title string) WalkthroughStep {
	step := WalkthroughStep{
		ID:    fmt.Sprintf("step-%d", index+1),
		Title: normalizeStepTitle(title),
		Files: make([]WalkthroughFile, 0, 2),
	}
	byPath := make(map[string]int)
	for _, unit := range units {
		file := files[unit.file]
		entry, ok := byPath[file.Path]
		if !ok {
			step.Files = append(step.Files, WalkthroughFile{
				Path:    file.Path,
				OldPath: file.OldPath,
				Hunks:   make([]int, 0, 1),
			})
			entry = len(step.Files) - 1
			byPath[file.Path] = entry
		}
		if unit.hunk < 0 {
			step.Additions += file.Additions
			step.Deletions += file.Deletions
			continue
		}
		hunk := file.Hunks[unit.hunk]
		added, deleted := hunkStats(hunk)
		step.Additions += added
		step.Deletions += deleted
		step.Files[entry].Hunks = append(step.Files[entry].Hunks, unit.hunk)
	}
	for index := range step.Files {
		sort.Ints(step.Files[index].Hunks)
	}
	return step
}

func hunkStats(hunk Hunk) (added, deleted int) {
	for _, line := range hunk.Lines {
		switch line.Kind {
		case "add":
			added++
		case "del":
			deleted++
		}
	}
	return added, deleted
}

// buildMoveGroups finds the cross-file stories worth keeping together: a
// renamed entity, a move sem reports with OldFilePath, and a delete/add pair
// with the same name and near-identical content.
func buildMoveGroups(files []File) []walkthroughGroup {
	groups := make([]walkthroughGroup, 0)
	indexByKey := make(map[string]int)
	used := make(map[changeRef]bool)

	add := func(key, title string, units []walkthroughUnit) {
		if key == "" || len(units) == 0 {
			return
		}
		if index, ok := indexByKey[key]; ok {
			groups[index].units = append(groups[index].units, units...)
			return
		}
		indexByKey[key] = len(groups)
		groups = append(groups, walkthroughGroup{title: title, units: units})
	}

	for fileIndex := range files {
		file := files[fileIndex]
		for changeIndex, change := range file.Semantic {
			switch {
			case change.OldFilePath != "" && change.OldFilePath != file.Path:
				oldName := change.OldEntityName
				if oldName == "" {
					oldName = change.EntityName
				}
				key := "move|" + change.OldFilePath + "|" + file.Path + "|" + oldName
				units := changeUnits(fileIndex, file, change, true, false)
				for oldIndex := range files {
					if oldIndex == fileIndex || files[oldIndex].Path != change.OldFilePath {
						continue
					}
					for oldChangeIndex, moved := range files[oldIndex].Semantic {
						if moved.ChangeType != "deleted" || moved.EntityName != oldName {
							continue
						}
						units = append(units, changeUnits(oldIndex, files[oldIndex], moved, false, true)...)
						used[changeRef{file: oldIndex, change: oldChangeIndex}] = true
					}
				}
				used[changeRef{file: fileIndex, change: changeIndex}] = true
				add(key, moveTitle(oldName, file.Path), units)
			case change.ChangeType == "renamed" && change.OldEntityName != "":
				key := "rename|" + file.Path + "|" + change.OldEntityName + "|" + change.EntityName
				used[changeRef{file: fileIndex, change: changeIndex}] = true
				add(key, renameTitle(change.OldEntityName, change.EntityName),
					changeUnits(fileIndex, file, change, true, true))
			case change.ChangeType == "moved":
				name := change.EntityName
				key := "moved|" + file.Path + "|" + name
				used[changeRef{file: fileIndex, change: changeIndex}] = true
				add(key, "Move "+displayName(name, file.Path),
					changeUnits(fileIndex, file, change, true, true))
			}
		}
	}

	// sem reports a cross-file move as a deletion and an addition when it
	// cannot prove the identity; pair them by name, type and body shape.
	var deleted, added []changeRef
	for fileIndex := range files {
		for changeIndex, change := range files[fileIndex].Semantic {
			ref := changeRef{file: fileIndex, change: changeIndex}
			if used[ref] {
				continue
			}
			switch change.ChangeType {
			case "deleted":
				deleted = append(deleted, ref)
			case "added":
				added = append(added, ref)
			}
		}
	}
	for _, addedRef := range added {
		addedChange := files[addedRef.file].Semantic[addedRef.change]
		best := -1
		bestScore := moveSimilarity
		for index, deletedRef := range deleted {
			if used[deletedRef] {
				continue
			}
			deletedChange := files[deletedRef.file].Semantic[deletedRef.change]
			if deletedChange.EntityType != addedChange.EntityType ||
				deletedChange.EntityName != addedChange.EntityName ||
				files[deletedRef.file].Path == files[addedRef.file].Path {
				continue
			}
			similarity := contentSimilarity(deletedChange.before, addedChange.after)
			if similarity <= bestScore {
				continue
			}
			best = index
			bestScore = similarity
		}
		if best < 0 {
			continue
		}
		deletedRef := deleted[best]
		deletedChange := files[deletedRef.file].Semantic[deletedRef.change]
		key := "paired|" + files[deletedRef.file].Path + "|" + files[addedRef.file].Path + "|" + deletedChange.EntityName
		units := changeUnits(deletedRef.file, files[deletedRef.file], deletedChange, false, true)
		units = append(units, changeUnits(addedRef.file, files[addedRef.file], addedChange, true, false)...)
		used[addedRef] = true
		used[deletedRef] = true
		add(key, moveTitle(deletedChange.EntityName, files[addedRef.file].Path), units)
	}

	return groups
}

// changeUnits resolves a semantic change to hunk indices. newSide and oldSide
// pick which line ranges apply; a change in a different file must not match the
// new file's hunks against its old range.
func changeUnits(fileIndex int, file File, change SemanticChange, newSide, oldSide bool) []walkthroughUnit {
	units := make([]walkthroughUnit, 0, 2)
	for hunkIndex, hunk := range file.Hunks {
		if newSide && hunkTouchesNew(hunk, change) {
			units = append(units, walkthroughUnit{file: fileIndex, hunk: hunkIndex})
			continue
		}
		if oldSide && hunkTouchesOld(hunk, change) {
			units = append(units, walkthroughUnit{file: fileIndex, hunk: hunkIndex})
		}
	}
	return units
}

func hunkTouchesNew(hunk Hunk, change SemanticChange) bool {
	if hunk.NewCount <= 0 || change.StartLine <= 0 || change.EndLine < change.StartLine {
		return false
	}
	return rangesOverlap(hunk.NewStart, hunk.NewStart+hunk.NewCount-1, change.StartLine, change.EndLine)
}

func hunkTouchesOld(hunk Hunk, change SemanticChange) bool {
	if hunk.OldCount <= 0 || change.OldStartLine <= 0 || change.OldEndLine < change.OldStartLine {
		return false
	}
	return rangesOverlap(hunk.OldStart, hunk.OldStart+hunk.OldCount-1, change.OldStartLine, change.OldEndLine)
}

func rangesOverlap(start, end, otherStart, otherEnd int) bool {
	return start <= otherEnd && otherStart <= end
}

func walkthroughFileTitle(file File) string {
	best := SemanticChange{}
	bestWeight := 0.0
	for _, change := range file.Semantic {
		if change.Cosmetic {
			continue
		}
		weight := changeWeights[change.ChangeType]
		if weight > bestWeight {
			best = change
			bestWeight = weight
		}
	}
	if bestWeight == 0 {
		return "Update " + baseName(file.Path)
	}
	verb := "Change"
	switch best.ChangeType {
	case "added":
		verb = "Add"
	case "deleted":
		verb = "Delete"
	case "renamed":
		verb = "Rename"
	case "moved":
		verb = "Move"
	case "reordered":
		verb = "Reorder"
	}
	return verb + " " + displayName(best.EntityName, file.Path)
}

func displayName(name, filePath string) string {
	name = strings.TrimSpace(name)
	if name == "" || name == "module-level" {
		return baseName(filePath)
	}
	return name
}

func baseName(filePath string) string {
	return path.Base(filePath)
}

func moveTitle(name, newPath string) string {
	return "Move " + displayName(name, newPath) + " to " + baseName(newPath)
}

func renameTitle(oldName, newName string) string {
	return "Rename " + displayName(oldName, "") + " to " + displayName(newName, "")
}

// normalizeStepTitle folds a generated title onto one line. Length is the
// sidebar's problem: it truncates with CSS, so the full title stays in the
// payload and in the row's tooltip.
func normalizeStepTitle(title string) string {
	return strings.TrimSpace(strings.ReplaceAll(title, "\n", " "))
}
