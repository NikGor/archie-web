// Model catalog checked against OpenRouter on 2026-10-17 (ARCHIE-227).
// New models are offered only in stages that passed the sandbox.
const AI_MODELS = {
    "openai": [
        "gpt-4.1",
        "gpt-5.6-luna",
        "gpt-4.1-mini",
        "gpt-4.1-nano",
        "gpt-5.4",
        "gpt-5.4-pro",
        "gpt-5.4-mini",
        "gpt-5.4-nano"
    ],
    "openrouter": [
        "google/gemini-3.1-pro-preview",
        "google/gemini-3-flash-preview",
        "google/gemini-3.1-flash-lite-preview",
        "anthropic/claude-opus-4.6",
        "anthropic/claude-sonnet-4.6",
        "anthropic/claude-opus-4.5",
        "anthropic/claude-sonnet-4.5",
        "anthropic/claude-haiku-4.5",
        "openai/gpt-6.1-sol",
        "openai/gpt-6-luna",
        "openai/gpt-6-astra",
        "openai/gpt-5.6-terra",
        "anthropic/claude-haiku-5.5",
        "google/gemini-4-argon",
        "google/gemini-3.8-flash",
        "google/gemini-3.5-flash-lite",
        "x-ai/grok-4.7",
        "deepseek/deepseek-v4.1-flash-1017",
        "deepseek/deepseek-v4-pro-0813",
        "qwen/qwen3.8-max-prime",
        "qwen/qwen3.8-flash",
        "qwen/qwen3.8-27b",
        "z-ai/glm-5.3",
        "z-ai/glm-5.3-flash",
        "moonshotai/kimi-k3",
        "minimax/minimax-m3",
        "mistralai/mistral-large-4-0",
        "meta/muse-spark-open",
        "meta/muse-wonder",
        "stepfun/step-5-preview",
        "reflection/beam-1.0-501b-a23b",
        "elorian/glimpse",
        "inclusionai/ling-3.1-flash",
        "inference-net/schematron-v2-turbo",
        "inference-net/schematron-v2-small",
        "inception/mercury-2.5",
        "nex-agi/nex-n2.5-mini",
        "nex-agi/nex-n2.5-pro",
        "cohere/command-a-plus",
        "upstage/solar-mini4",
        "xiaomi/mimo-v2.6-flash",
        "xiaomi/mimo-v2.6-pro",
        "google/gemma-4-31b-it",
        "google/gemma-4-26b-a4b-it",
        "mistralai/mistral-medium-3-5",
        "tencent/hy4-preview",
        "prism-ml/ternary-bonsai-2-27b",
        "fireworks/ember-1",
        "arcee-ai/trinity-large-thinking"
    ]
};
const AI_MODEL_CAPABILITIES = {
    "openai/gpt-6.1-sol": {
        "command": true,
        "final_plain": true,
        "final_ui": true
    },
    "openai/gpt-6-luna": {
        "command": true,
        "final_plain": true,
        "final_ui": true
    },
    "openai/gpt-6-astra": {
        "command": true,
        "final_plain": true,
        "final_ui": true
    },
    "openai/gpt-5.6-terra": {
        "command": true,
        "final_plain": true,
        "final_ui": true
    },
    "anthropic/claude-haiku-5.5": {
        "command": true,
        "final_plain": true,
        "final_ui": false
    },
    "anthropic/claude-sonnet-5.5": {
        "command": false,
        "final_plain": false,
        "final_ui": false
    },
    "anthropic/claude-opus-5.5": {
        "command": false,
        "final_plain": false,
        "final_ui": false
    },
    "anthropic/claude-fable-5.1": {
        "command": false,
        "final_plain": false,
        "final_ui": false
    },
    "google/gemini-4-argon": {
        "command": true,
        "final_plain": true,
        "final_ui": true
    },
    "google/gemini-3.8-flash": {
        "command": true,
        "final_plain": true,
        "final_ui": false
    },
    "google/gemini-3.5-flash-lite": {
        "command": true,
        "final_plain": true,
        "final_ui": false
    },
    "x-ai/grok-4.7": {
        "command": true,
        "final_plain": true,
        "final_ui": true
    },
    "deepseek/deepseek-v4.1-flash-1017": {
        "command": true,
        "final_plain": true,
        "final_ui": false
    },
    "deepseek/deepseek-v4-pro-0813": {
        "command": false,
        "final_plain": true,
        "final_ui": true
    },
    "qwen/qwen3.8-max-prime": {
        "command": true,
        "final_plain": true,
        "final_ui": true
    },
    "qwen/qwen3.8-flash": {
        "command": true,
        "final_plain": true,
        "final_ui": false
    },
    "qwen/qwen3.8-27b": {
        "command": true,
        "final_plain": false,
        "final_ui": false
    },
    "z-ai/glm-5.3": {
        "command": true,
        "final_plain": true,
        "final_ui": false
    },
    "z-ai/glm-5.3-flash": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "moonshotai/kimi-k3": {
        "command": true,
        "final_plain": true,
        "final_ui": true
    },
    "minimax/minimax-m3": {
        "command": true,
        "final_plain": true,
        "final_ui": false
    },
    "mistralai/mistral-large-4-0": {
        "command": true,
        "final_plain": true,
        "final_ui": true
    },
    "nvidia/nemotron-3.5-super-vl": {
        "command": false,
        "final_plain": false,
        "final_ui": false
    },
    "nvidia/nemotron-3.5-lightning": {
        "command": false,
        "final_plain": false,
        "final_ui": false
    },
    "meta/muse-spark-open": {
        "command": true,
        "final_plain": true,
        "final_ui": true
    },
    "meta/muse-wonder": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "stepfun/step-5-preview": {
        "command": true,
        "final_plain": true,
        "final_ui": false
    },
    "reflection/beam-1.0-501b-a23b": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "elorian/glimpse": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "liquid/lfm-2.5-24b-a2b": {
        "command": false,
        "final_plain": false,
        "final_ui": false
    },
    "inclusionai/ling-3.1-flash": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "inference-net/schematron-v2-turbo": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "inference-net/schematron-v2-small": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "inception/mercury-2.5": {
        "command": true,
        "final_plain": true,
        "final_ui": true
    },
    "nex-agi/nex-n2.5-mini": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "nex-agi/nex-n2.5-pro": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "cohere/command-a-plus": {
        "command": false,
        "final_plain": true,
        "final_ui": true
    },
    "upstage/solar-mini4": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "xiaomi/mimo-v2.6-flash": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "xiaomi/mimo-v2.6-pro": {
        "command": true,
        "final_plain": true,
        "final_ui": false
    },
    "google/gemma-4-31b-it": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "google/gemma-4-26b-a4b-it": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "mistralai/mistral-medium-3-5": {
        "command": true,
        "final_plain": true,
        "final_ui": true
    },
    "upstage/solar-pro4": {
        "command": false,
        "final_plain": false,
        "final_ui": false
    },
    "ibm-granite/granite-4.2-8b": {
        "command": false,
        "final_plain": false,
        "final_ui": false
    },
    "sakana/fugu-ultra-v2": {
        "command": false,
        "final_plain": false,
        "final_ui": false
    },
    "sakana/fugu-max": {
        "command": false,
        "final_plain": false,
        "final_ui": false
    },
    "tencent/hy4-preview": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    },
    "prism-ml/ternary-bonsai-2-27b": {
        "command": false,
        "final_plain": true,
        "final_ui": true
    },
    "fireworks/ember-1": {
        "command": true,
        "final_plain": true,
        "final_ui": true
    },
    "aion-labs/aion-3.5-mini": {
        "command": false,
        "final_plain": false,
        "final_ui": false
    },
    "aion-labs/aion-3.5": {
        "command": false,
        "final_plain": false,
        "final_ui": false
    },
    "arcee-ai/trinity-large-thinking": {
        "command": false,
        "final_plain": true,
        "final_ui": false
    }
};
const AI_VISION_MODELS = [
    "anthropic/claude-haiku-4.5",
    "anthropic/claude-haiku-5.5",
    "anthropic/claude-opus-4.5",
    "anthropic/claude-opus-4.6",
    "anthropic/claude-sonnet-4.5",
    "anthropic/claude-sonnet-4.6",
    "cohere/command-a-plus",
    "deepseek/deepseek-v4.1-flash-1017",
    "elorian/glimpse",
    "fireworks/ember-1",
    "google/gemini-3-flash-preview",
    "google/gemini-3.1-flash-lite-preview",
    "google/gemini-3.1-pro-preview",
    "google/gemini-3.5-flash-lite",
    "google/gemini-3.8-flash",
    "google/gemini-4-argon",
    "google/gemma-4-26b-a4b-it",
    "google/gemma-4-31b-it",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.4-pro",
    "gpt-5.6-luna",
    "meta/muse-spark-open",
    "meta/muse-wonder",
    "minimax/minimax-m3",
    "mistralai/mistral-large-4-0",
    "mistralai/mistral-medium-3-5",
    "moonshotai/kimi-k3",
    "nex-agi/nex-n2.5-mini",
    "nex-agi/nex-n2.5-pro",
    "openai/gpt-5.6-terra",
    "openai/gpt-6-astra",
    "openai/gpt-6-luna",
    "openai/gpt-6.1-sol",
    "prism-ml/ternary-bonsai-2-27b",
    "qwen/qwen3.8-27b",
    "qwen/qwen3.8-flash",
    "qwen/qwen3.8-max-prime",
    "stepfun/step-5-preview",
    "x-ai/grok-4.7",
    "xiaomi/mimo-v2.6-flash",
    "xiaomi/mimo-v2.6-pro",
    "z-ai/glm-5.3-flash"
];
const AI_MODEL_PRICES = {
    "gpt-5.6-luna": {
        "input": 1.0,
        "output": 6.0
    },
    "gpt-4.1": {
        "input": 2.0,
        "output": 8.0
    },
    "gpt-4.1-mini": {
        "input": 0.4,
        "output": 1.6
    },
    "gpt-4.1-nano": {
        "input": 0.1,
        "output": 0.4
    },
    "gpt-5.4": {
        "input": 2.5,
        "output": 15.0
    },
    "gpt-5.4-pro": {
        "input": 30.0,
        "output": 180.0
    },
    "gpt-5.4-mini": {
        "input": 0.75,
        "output": 4.5
    },
    "gpt-5.4-nano": {
        "input": 0.2,
        "output": 1.25
    },
    "google/gemini-3.1-pro-preview": {
        "input": 2.0,
        "output": 12.0,
        "cached": 0.2
    },
    "google/gemini-3-flash-preview": {
        "input": 0.5,
        "output": 3.0,
        "cached": 0.05
    },
    "google/gemini-3.1-flash-lite-preview": {
        "input": 0.25,
        "output": 1.5,
        "cached": 0.025
    },
    "google/gemini-3-pro-image-preview": {
        "input": 2.0,
        "output": 12.0,
        "cached": 0.2
    },
    "anthropic/claude-opus-4.6": {
        "input": 5.0,
        "output": 25.0,
        "cached": 0.5
    },
    "anthropic/claude-sonnet-4.6": {
        "input": 3.0,
        "output": 15.0,
        "cached": 0.3
    },
    "anthropic/claude-opus-4.5": {
        "input": 5.0,
        "output": 25.0,
        "cached": 0.5
    },
    "anthropic/claude-sonnet-4.5": {
        "input": 3.0,
        "output": 15.0,
        "cached": 0.3
    },
    "anthropic/claude-haiku-4.5": {
        "input": 1.0,
        "output": 5.0,
        "cached": 0.1
    },
    "x-ai/grok-4.20-beta": {
        "input": 2.0,
        "output": 6.0
    },
    "x-ai/grok-4.1-fast": {
        "input": 0.2,
        "output": 0.5
    },
    "inference-net/schematron-v2-small": {
        "input": 0.05,
        "output": 0.23,
        "cached": 0.05
    },
    "meta/muse-spark-open": {
        "input": 1.25,
        "output": 4.25,
        "cached": 0.15
    },
    "deepseek/deepseek-v4-pro-0813": {
        "input": 0.66,
        "output": 1.98,
        "cached": 0.022
    },
    "reflection/beam-1.0-501b-a23b": {
        "input": 1.0,
        "output": 3.0,
        "cached": 0.1
    },
    "qwen/qwen3.8-flash": {
        "input": 0.15,
        "output": 0.47,
        "cached": 0.016
    },
    "inception/mercury-2.5": {
        "input": 0.04,
        "output": 0.15,
        "cached": 0.004
    },
    "sakana/fugu-max": {
        "input": 2.0,
        "output": 6.0,
        "cached": 0.25
    },
    "prism-ml/ternary-bonsai-2-27b": {
        "input": 0.075,
        "output": 0.5,
        "cached": 0.0375
    },
    "z-ai/glm-5.3": {
        "input": 0.079,
        "output": 4.8,
        "cached": 0.078
    },
    "nex-agi/nex-n2.5-mini": {
        "input": 0.025,
        "output": 0.1,
        "cached": 0.0025
    },
    "x-ai/grok-4.7": {
        "input": 2.0,
        "output": 6.0,
        "cached": 0.5
    },
    "openai/gpt-6-luna": {
        "input": 0.1,
        "output": 0.5,
        "cached": 0.01
    },
    "anthropic/claude-fable-5.1": {
        "input": 10.0,
        "output": 50.0,
        "cached": 0.25
    },
    "anthropic/claude-haiku-5.5": {
        "input": 0.1,
        "output": 0.5,
        "cached": 0.01
    },
    "nvidia/nemotron-3.5-lightning": {
        "input": 0.07,
        "output": 0.2,
        "cached": 0.04
    },
    "inclusionai/ling-3.1-flash": {
        "input": 0.075,
        "output": 0.225,
        "cached": 0.015
    },
    "cohere/command-a-plus": {
        "input": 0.3,
        "output": 1.5,
        "cached": 0.15
    },
    "fireworks/ember-1": {
        "input": 3.0,
        "output": 15.0,
        "cached": 0.3
    },
    "mistralai/mistral-medium-3-5": {
        "input": 1.5,
        "output": 7.5
    },
    "sakana/fugu-ultra-v2": {
        "input": 5.0,
        "output": 30.0,
        "cached": 0.5
    },
    "deepseek/deepseek-v4.1-flash-1017": {
        "input": 0.15,
        "output": 0.6,
        "cached": 0.003
    },
    "qwen/qwen3.8-27b": {
        "input": 0.24,
        "output": 2.2,
        "cached": 0.05
    },
    "meta/muse-wonder": {
        "input": 4.0,
        "output": 20.0,
        "cached": 0.2
    },
    "google/gemma-4-31b-it": {
        "input": 0.2,
        "output": 0.4
    },
    "liquid/lfm-2.5-24b-a2b": {
        "input": 0.05,
        "output": 0.7,
        "cached": 0.025
    },
    "aion-labs/aion-3.5-mini": {
        "input": 0.7,
        "output": 1.4,
        "cached": 0.18
    },
    "nvidia/nemotron-3.5-super-vl": {
        "input": 0.1,
        "output": 0.4,
        "cached": 0.08
    },
    "google/gemini-3.8-flash": {
        "input": 0.825,
        "output": 4.125,
        "cached": 0.0825
    },
    "elorian/glimpse": {
        "input": 0.6,
        "output": 3.0,
        "cached": 0.06
    },
    "anthropic/claude-sonnet-5.5": {
        "input": 2.0,
        "output": 10.0,
        "cached": 0.1
    },
    "openai/gpt-5.6-terra": {
        "input": 2.0,
        "output": 12.0,
        "cached": 0.2
    },
    "upstage/solar-mini4": {
        "input": 0.05,
        "output": 0.2,
        "cached": 0.005
    },
    "xiaomi/mimo-v2.6-flash": {
        "input": 0.14,
        "output": 0.28,
        "cached": 0.0028
    },
    "tencent/hy4-preview": {
        "input": 0.7506,
        "output": 2.2509,
        "cached": 0.0378
    },
    "inference-net/schematron-v2-turbo": {
        "input": 0.03,
        "output": 0.15,
        "cached": 0.03
    },
    "ibm-granite/granite-4.2-8b": {
        "input": 0.06,
        "output": 0.25,
        "cached": 0.015
    },
    "arcee-ai/trinity-large-thinking": {
        "input": 0.25,
        "output": 0.8,
        "cached": 0.06
    },
    "minimax/minimax-m3": {
        "input": 0.3,
        "output": 1.2,
        "cached": 0.06
    },
    "mistralai/mistral-large-4-0": {
        "input": 0.68,
        "output": 2.09,
        "cached": 0.07
    },
    "google/gemini-3.5-flash-lite": {
        "input": 0.3,
        "output": 2.5,
        "cached": 0.03
    },
    "xiaomi/mimo-v2.6-pro": {
        "input": 0.435,
        "output": 0.87,
        "cached": 0.0036
    },
    "qwen/qwen3.8-max-prime": {
        "input": 4.0,
        "output": 12.0,
        "cached": 0.5
    },
    "moonshotai/kimi-k3": {
        "input": 0.304,
        "output": 11.936,
        "cached": 0.21
    },
    "anthropic/claude-opus-5.5": {
        "input": 4.0,
        "output": 20.0,
        "cached": 0.2
    },
    "nex-agi/nex-n2.5-pro": {
        "input": 0.075,
        "output": 0.25,
        "cached": 0.015
    },
    "aion-labs/aion-3.5": {
        "input": 3.0,
        "output": 6.0,
        "cached": 0.75
    },
    "openai/gpt-6.1-sol": {
        "input": 2.0,
        "output": 10.0,
        "cached": 0.1
    },
    "z-ai/glm-5.3-flash": {
        "input": 0.15,
        "output": 0.5,
        "cached": 0.03
    },
    "google/gemini-4-argon": {
        "input": 2.0,
        "output": 10.0,
        "cached": 0.1
    },
    "openai/gpt-6-astra": {
        "input": 10.0,
        "output": 50.0,
        "cached": 1.0
    },
    "google/gemma-4-26b-a4b-it": {
        "input": 0.0675,
        "output": 0.225,
        "cached": 0.0375
    },
    "upstage/solar-pro4": {
        "input": 0.09,
        "output": 0.36,
        "cached": 0.018
    },
    "stepfun/step-5-preview": {
        "input": 1.0,
        "output": 2.7,
        "cached": 0.1
    }
};

