/**
 * name: Batch Fill Overlay
 * description: Applies a color fill overlay to the current selection. Edit FILL and OPACITY below, then Run.
 * version: 0.1.0
 * author: Scriptify
 */

// Starter template: replicate one fill across a selection.
// Adjust these two values for your brand overlay.
const FILL = '#FF6600';
const OPACITY = 0.25;

const { app } = require('/application');

async function main() {
  // NOTE: exact layer/fill API varies by Affinity 3.x SDK build.
  // Check the Docs tab (read_sdk_documentation_topic) for your build's
  // selection + fill calls, then replace the stub below.
  console.log(`Applying overlay fill=${FILL} opacity=${OPACITY}`);
  app.alert(`Overlay template loaded. Fill ${FILL} @ ${OPACITY * 100}%. Wire to SDK fill API next.`);
}

main();
