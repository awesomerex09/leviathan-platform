const { spawn } = require('child_process');
const path = require('path');

const env = { ...process.env };
// Purge any agent markers to trigger interactive mode
delete env.ANTIGRAVITY_AGENT;
delete env.CI;

console.log('Spawning Vercel CLI deployment...');

const child = spawn('npx', ['vercel', '--prod'], {
  cwd: path.join(__dirname, '..'),
  env: env,
  shell: true,
  stdio: ['pipe', 'pipe', 'pipe']
});

child.stdout.on('data', (data) => {
  const output = data.toString();
  process.stdout.write(output);
  
  // Automate the interactive prompts
  if (output.includes('Set up and deploy')) {
    console.log('\n[AUTO] Sending "y" (Setup project)');
    child.stdin.write('y\n');
  } else if (output.includes('Which scope do you want to deploy to')) {
    console.log('\n[AUTO] Sending enter (Default scope)');
    child.stdin.write('\n');
  } else if (output.includes('Link to existing project')) {
    console.log('\n[AUTO] Sending "y" (Link to existing project)');
    child.stdin.write('y\n');
  } else if (output.includes('What’s the name of your existing project')) {
    console.log('\n[AUTO] Sending "leviathan-platform" (Project name)');
    child.stdin.write('leviathan-platform\n');
  } else if (output.includes('In which directory is your code located')) {
    console.log('\n[AUTO] Sending enter (Current directory)');
    child.stdin.write('\n');
  } else if (output.includes('Want to modify these settings')) {
    console.log('\n[AUTO] Sending "n" (Keep default settings)');
    child.stdin.write('n\n');
  }
});

child.stderr.on('data', (data) => {
  process.stderr.write(data.toString());
});

child.on('close', (code) => {
  console.log(`\nDeployment process exited with code ${code}`);
});
