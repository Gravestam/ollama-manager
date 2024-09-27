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
	let language = '';
	const lines = text.split('\n');
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
	.option('-h, --host <host>', 'Specify the API host and port', HOST);

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
