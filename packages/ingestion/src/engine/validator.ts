/**
 * Validator — runs the adapter's validationRules over the produced segments.
 * Returns issues (errors block, warnings are advisory). Counts that vary by
 * commune (e.g. number of zones) are logged, not asserted, when `expected` is null.
 */
import type { DocumentAdapter, Segment, ValidationIssue } from "../adapters/interface.ts";

export function validate(segments: Segment[], adapter: DocumentAdapter): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const zones = segments.filter((s) => s.segment_type === "zone");

  for (const rule of adapter.validationRules) {
    switch (rule.type) {
      case "zone_count": {
        if (rule.expected !== null && zones.length !== rule.expected) {
          issues.push({
            rule: rule.type,
            severity: "error",
            message: `Attendu ${rule.expected} zones, trouvé ${zones.length}.`,
          });
        }
        break;
      }
      case "article_count_per_zone": {
        for (const zone of zones) {
          if (zone.subsections.length !== rule.expected) {
            issues.push({
              rule: rule.type,
              severity: "warning",
              message: `Zone ${zone.segment_code} : ${zone.subsections.length} articles (attendu ${rule.expected}).`,
              segment_id: zone.id,
            });
          }
        }
        break;
      }
      case "no_empty_segments": {
        for (const seg of segments) {
          for (const field of rule.fields) {
            const v = seg[field];
            if (typeof v === "string" && v.trim() === "") {
              issues.push({
                rule: rule.type,
                severity: "error",
                message: `Segment ${seg.segment_code} : champ « ${String(field)} » vide.`,
                segment_id: seg.id,
              });
            }
          }
        }
        break;
      }
      case "known_zone_codes": {
        for (const zone of zones) {
          if (!rule.pattern.test(zone.segment_code)) {
            issues.push({
              rule: rule.type,
              severity: "warning",
              message: `Code de zone inattendu : « ${zone.segment_code} ».`,
              segment_id: zone.id,
            });
          }
        }
        break;
      }
    }
  }

  return issues;
}
