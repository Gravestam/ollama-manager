#!/usr/bin/env node

import os from 'os';
import { Ollama } from 'ollama';
import { Command } from 'commander';
import chalk from 'chalk';
import { createSpinner } from 'nanospinner';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import prompts from 'prompts';
import { highlight } from 'cli-highlight';
import { spawn } from 'child_process';
const RED = chalk.red;
const GREEN = chalk.green;
const YELLOW = chalk.yellow;
const BLUE = chalk.blue;
const CYAN = chalk.cyan;
const NC = chalk.reset;
const CODE_BLOCK_BG = chalk.white.bgHex('#333');

// Default settings
let QUIET = false;
let HOST = 'http://127.0.0.1:11434';

const CONFIG_FILE = path.join(
	process.env.HOME || process.env.USERPROFILE,
	'.ollama_script_config'
);

const loadConfig = () => {

	if (fs.existsSync(CONFIG_FILE)) {

		const config = fs.readFileSync(CONFIG_FILE, 'utf8');
		const configObj = JSON.parse(config);
		QUIET = configObj.QUIET !== undefined ? configObj.QUIET : QUIET;
	}
};

const log = (message) => {

	if (!QUIET) {

		console.log(message);
	}
};

const getSystemInfo = async () => {

	const systemInfo = {
		user: await os.userInfo(),
		platform: await os.platform(),
		type: await os.type(),
		version: await os.version(),
		network: await os.networkInterfaces(),
		eol: os.EOL
	};

	return systemInfo;
};

const copyToClipboard = (text, sanitizeText = false) => {

    return new Promise((resolve, reject) => {

        try {

            if (sanitizeText) {

                text = text
                    .replace(/```[a-z]*\n?/gi, '')   // Remove the code block language specifier (e.g., ```bash)
                    .replace(/```/g, '')             // Remove any closing triple backticks
                    .replace(/\n+/g, ' ')            // Replace newlines with spaces to make it a single line
                    .trim();                         // Trim any leading or trailing spaces
            }

            const clipboardProcess = spawn(program.opts().clipboardManager, [], {
                stdio: ['pipe', 'ignore', 'ignore'], // Only pipe stdin to send text, ignore stdout and stderr
            });

            clipboardProcess.stdin.write(text);
            clipboardProcess.stdin.end();

            const spinner = createSpinner(`Copying to clipboard using ${program.opts().clipboardManager}...`).start();

            clipboardProcess.on('error', (error) => {
                spinner.error({ text: `Error copying to clipboard using ${program.opts().clipboardManager}: ${error.message}` });
                reject(error);
            });

            clipboardProcess.on('close', (code) => {

                if (code === 0) {

                    spinner.success({ text: `Command successfully copied to clipboard using ${program.opts().clipboardManager}.` });
                    resolve();
                }
				else {

                    spinner.error({ text: `${program.opts().clipboardManager} exited with code ${code}.` });

                    reject(new Error(`${program.opts().clipboardManager} exited with code ${code}`));
                }
            });

        } catch (error) {

            console.log(RED(`Error copying to clipboard: ${error.message}`));
            reject(error);
        }
    });
};

const cliCommandPrompt = (systemInfo) => `Act as a natural language to ${systemInfo.user.shell} command translation engine on ${systemInfo.platform}. You are an expert in ${systemInfo.user.shell} on ${systemInfo.platform} and translate the question at the end to valid syntax.

Follow these rules:
Construct valid ${systemInfo.user.shell} command that solves the question
Leverage help and man pages to ensure valid syntax and an optimal solution
Be concise 
Just show the commands 
Return only plaintext
Do not wrap code in \`\`
Only show a single answer, but you can always chain commands together 
Think step by step
Only create valid syntax (you can use comments if it makes sense)
If python is installed you can use it to solve problems
If python3 is installed you can use it to solve problems
Even if there is a lack of details, attempt to find the most logical solution by going about it step by step
Do not return multiple solutions
Do not show html, styled, colored formatting 
Do not create invalid syntax 
Do not add unnecessary text in the response 
Do not add notes or intro sentences 
Do not show multiple distinct solutions to the question
Do not add explanations on what the commands do
Do not return what the question was 
Do not repeat or paraphrase the question in your response 
Do not cause syntax errors
Do not rush to a conclusion

Follow all of the above rules. This is important, you MUST follow the above rules. There are no exceptions to these rules.

Question:
`;

const getModels = async (cmd) => {

	const ollama = new Ollama({ host: HOST });

	try {

		if (cmd === 'list') {

			const list = await ollama.list();
			return list.models || [];
		}

		if (cmd === 'ps') {

			const list = await ollama.ps();
			return list.models || [];
		}

		console.log(RED('Invalid command to get models.'));
		process.exit(1);

	} catch (error) {

		console.log(RED('Error retrieving models.'));
		process.exit(1);
	}
};

const selectModel = async (models, promptMessage) => {

	const response = await prompts({
		type: 'select',
		name: 'model',
		message: CYAN(promptMessage),
		choices: models.map((model) => ({
			title: `${model.name} (${model.details.parameter_size})`,
			value: model
		}))
	});

	if (!response.model) {

		console.log(YELLOW('No model selected.'));
		process.exit(1);
	}

	return response.model;
};

const confirmAction = async (message) => {

	const response = await prompts({
		type: 'confirm',
		name: 'confirm',
		message: YELLOW(message),
		initial: false
	});

	if (!response.confirm) {

		console.log(YELLOW('Action canceled by user.'));
		process.exit(0);
	}
};

const formatResponse = (text) => {

	const lines = text.split('\n');
	let language = '';
	let inCodeBlock = false;
	let formattedText = '';

	lines.forEach((line, index) => {

		if (line.startsWith('```')) {

			inCodeBlock = !inCodeBlock;

			if (inCodeBlock) {

				language = line.replace('```', '').trim();
			} else {

				language = '';
				formattedText += NC('');
			}

		} else {

			if (inCodeBlock) {

				const highlightedCode = highlight(line, {
					language: language || 'plaintext',
					ignoreIllegals: true
				});

				formattedText += CODE_BLOCK_BG(highlightedCode) + NC('');

			} else {

				formattedText += line;
			}
		}

		if (index < lines.length - 1) {

			formattedText += '\n';
		}
	});

	return formattedText;
};

const createModel = async (baseModel, withSystemInfo) => {

	const ollama = new Ollama({ host: HOST });

	if (!baseModel) {

		const models = await getModels('list');

		if (models.length === 0) {

			console.log(YELLOW('No models installed.'));
			process.exit(1);
		}

		const selectedBaseModel = await selectModel(
			models,
			'Please select the base model for your new model:'
		);

		baseModel = selectedBaseModel.name;
	}

	const newModelResponse = await prompts({
		type: 'text',
		name: 'modelName',
		message: YELLOW('Please enter the name for your new model:')
	});

	const newModelName = newModelResponse.modelName.trim();

	if (!newModelName) {

		console.log(RED('Error: Model name cannot be empty.'));
		process.exit(1);
	}

	const systemResponse = await prompts({
		type: 'text',
		name: 'systemPrompt',
		message: YELLOW('Enter the SYSTEM prompt for your model (e.g., "You are Mario from Super Mario Bros."):')
	});

	let systemPrompt = systemResponse.systemPrompt.trim();

	if (!systemPrompt) {

		console.log(RED('Error: SYSTEM prompt cannot be empty.'));
		process.exit(1);
	}

	if (withSystemInfo) {

		const systemInfo = await getSystemInfo();
		systemPrompt += ` You are using the ${systemInfo.user.shell} shell on the ${systemInfo.platform} (${systemInfo.type}) platform. Your OS version is ${systemInfo.version} and your system is using the ${systemInfo.eol} EOL. You are an expert on everything that you use and you do not make any misstakes`;
	}

	const modelfile = `
FROM ${baseModel}
SYSTEM "${systemPrompt}"
`;

	log(GREEN(`Creating model '${newModelName}' based on '${baseModel}'...`));

	const spinner = createSpinner('Creating model...').start();

	try {

		await ollama.create({
			model: newModelName,
			modelfile: modelfile
		});
		spinner.success({ text: `Model '${newModelName}' created successfully.` });

	} catch (error) {

		spinner.error({ text: 'Error creating model.' });
		process.exit(1);
	}
};

const runModel = async (modelName) => {

	const ollama = new Ollama({ host: HOST });
	const systemInfo = await getSystemInfo();
	const models = await getModels('list');

	if (models.length === 0) {

		console.log(YELLOW('No models installed.'));
		process.exit(1);
	}

	let selectedModel = null;

	if (modelName) {

		const foundModel = models.find((model) => model.name === modelName);

		if (!foundModel) {

			console.log(RED(`Model '${modelName}' is not installed.`));
			process.exit(1);
		}

		selectedModel = foundModel;

	} else {

		selectedModel = await selectModel(models, 'Please select a model to run:');
	}

	log(GREEN(`Starting chat with model '${selectedModel.name}'...`));
	log(YELLOW('Type \'exit\' to end the chat.'));

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
		prompt: BLUE(`${systemInfo.user.username}: `)
	});

	let chatHistory = [];

	const resumePrompt = () => rl.resume() && rl.prompt();
	rl.prompt();

	rl.on('line', async (userInput) => {

		if (userInput.trim().toLowerCase() === 'exit') {

			log(YELLOW('Exiting chat.'));
			rl.close();
			process.exit(0);
		}

		rl.pause();

		const spinner = createSpinner(
			`${selectedModel.name} is generating a response...`
		).start();

		chatHistory.push({
			role: 'user',
			content: userInput
		});

		try {

			const response = await ollama.chat({
				model: selectedModel.name,
				messages: chatHistory,
				stream: false,
				role: 'user'
			});

			const modelResponse = response.message.content;

			chatHistory.push({
				role: 'assistant',
				content: modelResponse
			});

			const formattedResponse = formatResponse(modelResponse.trim());
			spinner.success({
				text: `${GREEN(`${selectedModel.name}:`)} ${formattedResponse}`
			});

		} catch (error) {

			spinner.error({ text: 'Error communicating with the Ollama API.' });
		}

		resumePrompt();
	});
};

const cliModel = async () => {

    const ollama = new Ollama({ host: HOST });
    const systemInfo = await getSystemInfo();
    const models = await getModels('list');

    if (models.length === 0) {

        console.log(YELLOW('No models installed.'));
        process.exit(1);
    }

    let selectedModel = await selectModel(models, 'Please select a model for CLI command generation:');

    log(GREEN(`Starting CLI command generation with model '${selectedModel.name}'...`));

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: BLUE(`${systemInfo.user.username}: `),
    });

    let chatHistory = [];

    const resumePrompt = () => rl.resume() && rl.prompt();

    rl.prompt();

    rl.on('line', async (userInput) => {

        rl.pause();

        const spinner = createSpinner(`${selectedModel.name} is generating a shell command...`).start();

        const cliPromptWithSystemInfo = cliCommandPrompt(systemInfo);

        chatHistory.push({
            role: 'user',
            content: `${cliPromptWithSystemInfo}: ${userInput}`
        });

        try {

            const response = await ollama.chat({
                model: selectedModel.name,
                messages: chatHistory,  // Keep history in the chat
                stream: false,
                role: 'user',
            });

            const modelResponse = response.message.content.trim();

            // Add the model's response to the chat history
            chatHistory.push({
                role: 'assistant',
                content: modelResponse,
            });

            const formattedResponse = formatResponse(modelResponse);

            spinner.success({
                text: `${GREEN(`${selectedModel.name}:`)} ${formattedResponse}`,
            });

            const actionResponse = await prompts({
                type: 'select',
                name: 'action',
                message: YELLOW('What would you like to do with this command?'),
                choices: [
                    { title: 'Run a new command generation', value: 'new' },
                    { title: 'Copy the command to clipboard', value: 'copy' },
                    { title: 'Cancel', value: 'cancel' },
                ],
            });

            if (actionResponse.action === 'copy') {

                await copyToClipboard(modelResponse, true);

                // console.log(GREEN('Command copied to clipboard.'));

                rl.close();
                process.exit(0);
            }
			else if (actionResponse.action === 'new') {

                resumePrompt();
            }
			else {

                console.log(YELLOW('Action canceled.'));

                rl.close();
                process.exit(0);
            }
        } catch (error) {
            spinner.error({ text: 'Error generating shell command.' });
            resumePrompt();
        }
    });
};

const removeModel = async (modelName) => {

	const ollama = new Ollama({ host: HOST });
	const models = await getModels('list');

	if (models.length === 0) {

		console.log(YELLOW('No models installed.'));
		process.exit(1);
	}

	let selectedModel = modelName;

	if (modelName) {

		if (!models.some((model) => model.name === modelName)) {

			console.log(RED(`Model '${modelName}' is not installed.`));
			process.exit(1);
		}

	} else {

		selectedModel = await selectModel(
			models,
			'Please select a model to remove:'
		);
	}

	await confirmAction(
		`Are you sure you want to remove model '${selectedModel.name}'?`
	);

	log(GREEN(`Removing model '${selectedModel.name}'...`));

	try {

		await ollama.delete({ model: selectedModel.name });

	} catch (error) {

		console.log(RED('Error removing model.'));
		process.exit(1);
	}
};

const showModel = async (modelName) => {

	const ollama = new Ollama({ host: HOST });
	let selectedModel = modelName;

	if (!selectedModel) {

		const models = await getModels('list');

		if (models.length === 0) {

			console.log(YELLOW('No models installed.'));
			process.exit(1);
		}

		selectedModel = await selectModel(
			models,
			'Please select a model to show information:'
		);
	}

	log(GREEN(`Showing information for model '${selectedModel.name}'...`));

	try {

		const info = await ollama.show({ model: selectedModel.name });
		console.log(info);

	} catch (error) {

		console.log(RED('Error showing model information.'));
		process.exit(1);
	}
};

const pullModel = async (modelName) => {

	const ollama = new Ollama({ host: HOST });

	if (!modelName) {

		console.log(RED('Error: Model name is required for pull.'));
		process.exit(1);
	}

	log(GREEN(`Pulling model '${modelName}'...`));

	const spinner = createSpinner('Pulling model...').start();

	try {

		await ollama.pull({ model: modelName });
		spinner.success({ text: 'Model pulled successfully.' });

	} catch (error) {

		spinner.error({ text: 'Error pulling model.' });
		process.exit(1);
	}
};

loadConfig();

const program = new Command();

program
	.name('ollama-manager')
	.description('CLI tool to manage Ollama models')
	.version('1.0.0');

program
	.option('-m, --model <model>', 'Specify the model name')
	.option('-q, --quiet', 'Suppress non-error messages')
	.option('-h, --host <host>', 'Specify the API host and port', HOST)
	.option('--clipboard-manager <manager>', 'Specify clipboard manager (e.g., wl-copy, xclip)', 'wl-copy');

program
	.command('run')
	.description('Run a model')
	.action(async () => {
		HOST = program.opts().host;
		const modelName = program.opts().model;
		QUIET = program.opts().quiet || false;
		await runModel(modelName);
	});

program
	.command('cli')
	.description('Generate a shell command using a model')
	.action(async () => {
		HOST = program.opts().host;
		QUIET = program.opts().quiet || false;
		await cliModel();
	});

program
	.command('create')
	.description('Create a new model')
	.option('--with-system-info', 'Include system information in the model prompt')
	.action(async (cmd) => {
		const baseModel = program.opts().model;
		QUIET = program.opts().quiet || false;

		const withSystemInfo = cmd.withSystemInfo || false;
		await createModel(baseModel, withSystemInfo);
	});

program
	.command('rm')
	.description('Remove a model')
	.action(async () => {
		const modelName = program.opts().model;
		QUIET = program.opts().quiet || false;
		await removeModel(modelName);
	});

program
	.command('show')
	.description('Show information for a model')
	.action(async () => {
		const modelName = program.opts().model;
		QUIET = program.opts().quiet || false;
		await showModel(modelName);
	});

program
	.command('pull')
	.description('Pull a model from a registry')
	.action(async () => {
		const modelName = program.opts().model;
		QUIET = program.opts().quiet || false;
		await pullModel(modelName);
	});

program.parse(process.argv);
