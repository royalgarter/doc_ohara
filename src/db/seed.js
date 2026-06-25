export const sampleDocuments = [
	{
		_id: "documents/quantum_paper_001",
		_key: "quantum_paper_001",
		source_file: "quantum_gravity_deep_learning.pdf",
		parser_engine: "MinerU",
		title: "On Quantum Gravity and Relational Neural Latents",
		file_size: "1.8 MB",
		upload_time: "2026-06-14T03:10:00Z"
	},
	{
		_id: "documents/travel_policy_002",
		_key: "travel_policy_002",
		source_file: "company_travel_policy_2026.docx",
		parser_engine: "Docling",
		title: "Global Operations and Travel Directives",
		file_size: "820 KB",
		upload_time: "2026-06-14T03:15:00Z"
	}
];

export const sampleSections = [
	// Sections for quantum gravity paper
	{
		_id: "sections/quantum_sec_1",
		_key: "quantum_sec_1",
		document_id: "quantum_paper_001",
		title: "1. Introduction to Relational Cosmology",
		level: 1
	},
	{
		_id: "sections/quantum_sec_2",
		_key: "quantum_sec_2",
		document_id: "quantum_paper_001",
		title: "2. Mathematical Framework & Metric Formulations",
		level: 1
	},
	{
		_id: "sections/quantum_sec_3",
		_key: "quantum_sec_3",
		document_id: "quantum_paper_001",
		title: "2.1 Spin-foam Latent Projections",
		level: 2
	},
	{
		_id: "sections/quantum_sec_4",
		_key: "quantum_sec_4",
		document_id: "quantum_paper_001",
		title: "3. Empirical Results and State Analysis",
		level: 1
	},
	
	// Sections for travel policy
	{
		_id: "sections/travel_sec_1",
		_key: "travel_sec_1",
		document_id: "travel_policy_002",
		title: "Section A: Strategic Purpose",
		level: 1
	},
	{
		_id: "sections/travel_sec_2",
		_key: "travel_sec_2",
		document_id: "travel_policy_002",
		title: "Section B: Travel Expense Approvals",
		level: 1
	},
	{
		_id: "sections/travel_sec_3",
		_key: "travel_sec_3",
		document_id: "travel_policy_002",
		title: "Section B.1: Flight Classes Guidelines",
		level: 2
	}
];

export const sampleParagraphs = [
	// Intro paragraphs for quantum paper
	{
		_id: "paragraphs/quantum_p_1",
		_key: "quantum_p_1",
		document_id: "quantum_paper_001",
		section_id: "sections/quantum_sec_1",
		content: "The unification of general relativity with relativistic quantum fields represents the primary frontier in standard physics. In this work, we propose a relational topology where space-time manifolds arise as emergent properties of parameterized neural network states."
	},
	{
		_id: "paragraphs/quantum_p_2",
		_key: "quantum_p_2",
		document_id: "quantum_paper_001",
		section_id: "sections/quantum_sec_1",
		content: "Under the holographic principal, any gauge field acts as a neural transmission layer where the boundary coordinates represent activation structures."
	},
	// Math paragraphs with LaTeX formulas
	{
		_id: "paragraphs/quantum_p_3",
		_key: "quantum_p_3",
		document_id: "quantum_paper_001",
		section_id: "sections/quantum_sec_2",
		content: "The Hilbert-Einstein state equation can be discretized over a connectivity tensor as follows:",
		is_latex: false
	},
	{
		_id: "paragraphs/quantum_p_4",
		_key: "quantum_p_4",
		document_id: "quantum_paper_001",
		section_id: "sections/quantum_sec_2",
		content: "S = \\frac{1}{16\\pi G} \\int_{\\mathcal{M}} R \\sqrt{-g} \\, d^4x + \\mathcal{L}_m",
		is_latex: true
	},
	{
		_id: "paragraphs/quantum_p_5",
		_key: "quantum_p_5",
		document_id: "quantum_paper_001",
		section_id: "sections/quantum_sec_3",
		content: "We define the boundary action projection using transition partitions computed by:"
	},
	{
		_id: "paragraphs/quantum_p_6",
		_key: "quantum_p_6",
		document_id: "quantum_paper_001",
		section_id: "sections/quantum_sec_3",
		content: "\\Psi_{\\Gamma}(\\eta) = \\sum_{j \\in S_n} \\prod_{f} (2j_f + 1) K\\bigl(s_f(j); \\sigma\\bigr)",
		is_latex: true
	},
	{
		_id: "paragraphs/quantum_p_7",
		_key: "quantum_p_7",
		document_id: "quantum_paper_001",
		section_id: "sections/quantum_sec_4",
		content: "Numerical evaluations of the relational latent nodes demonstrate clean convergence compared to standard non-perturbative string approximations."
	},

	// Travel Policy paragraphs
	{
		_id: "paragraphs/travel_p_1",
		_key: "travel_p_1",
		document_id: "travel_policy_002",
		section_id: "sections/travel_sec_1",
		content: "This document establishes standard procedures for all team members seeking operational travel. The core mandate ensures fiscal efficiency while maintaining secure traveling environments."
	},
	{
		_id: "paragraphs/travel_p_2",
		_key: "travel_p_2",
		document_id: "travel_policy_002",
		section_id: "sections/travel_sec_2",
		content: "All operational traveling requests exceeding $1,000 USD require visual and digital authorization from the regional vice president."
	},
	{
		_id: "paragraphs/travel_p_3",
		_key: "travel_p_3",
		document_id: "travel_policy_002",
		section_id: "sections/travel_sec_2",
		content: "Please submit all expense claims with valid optical receipts within 14 business days of completing the travel mission."
	},
	{
		_id: "paragraphs/travel_p_4",
		_key: "travel_p_4",
		document_id: "travel_policy_002",
		section_id: "sections/travel_sec_3",
		content: "Economy class is standard for all domestic routes under 6 hours duration. Business class upgrades are supported exclusively for intercontinental routes exceeding 10 hours continuous flight time, or on specific approval vectors."
	}
];

export const sampleTables = [
	{
		_id: "tables/quantum_t_1",
		_key: "quantum_t_1",
		document_id: "quantum_paper_001",
		section_id: "sections/quantum_sec_4",
		matrix_data: [
			["Dimension D", "Latent Nodes", "Loss (L_e)", "Convergence Rate"],
			["3D Manifold", "4,096 nodes", "1.24e-4", "94.2%"],
			["4D Manifold", "16,384 nodes", "8.92e-5", "96.8%"],
			["5D Bulk", "65,536 nodes", "3.01e-5", "99.1%"]
		],
		markdown_representation: "| Dimension D | Latent Nodes | Loss (L_e) | Convergence Rate |\n|---|---|---|---|\n| 3D Manifold | 4,096 nodes | 1.24e-4 | 94.2% |\n| 4D Manifold | 16,384 nodes | 8.92e-5 | 96.8% |\n| 5D Bulk | 65,536 nodes | 3.01e-5 | 99.1% |"
	},
	{
		_id: "tables/travel_t_1",
		_key: "travel_t_1",
		document_id: "travel_policy_002",
		section_id: "sections/travel_sec_3",
		matrix_data: [
			["Flight Duration", "Standard Class", "Exceptional Class Limit", "Sign-Off Required"],
			["< 6 Hours", "Economy", "Premium Economy", "Senior Manager"],
			["6 - 10 Hours", "Premium Economy", "Business Class", "Director"],
			["> 10 Hours", "Business Class", "First Class", "VP Operations"]
		],
		markdown_representation: "| Flight Duration | Standard Class | Exceptional Class Limit | Sign-Off Required |\n|---|---|---|---|\n| < 6 Hours | Economy | Premium Economy | Senior Manager |\n| 6 - 10 Hours | Premium Economy | Business Class | Director |\n| > 10 Hours | Business Class | First Class | VP Operations |"
	}
];

export function buildSampleEdges() {
	const edges = [];

	// Build document -> section edges (has_section)
	sampleSections.forEach(sec => {
		edges.push({
			_id: `has_section/${sec._key}`,
			_from: `documents/${sec.document_id}`,
			_to: `sections/${sec._key}`,
			type: 'has_section'
		});
		// Reverse belongs_to
		edges.push({
			_id: `belongs_to/${sec._key}`,
			_from: `sections/${sec._key}`,
			_to: `documents/${sec.document_id}`,
			type: 'belongs_to'
		});
	});

	// Build section -> paragraph edges (contains_paragraph)
	sampleParagraphs.forEach(p => {
		if (p.section_id) {
			edges.push({
				_id: `contains_paragraph/${p._key}`,
				_from: p.section_id,
				_to: `paragraphs/${p._key}`,
				type: 'contains_paragraph'
			});
			// Reverse belongs_to
			edges.push({
				_id: `belongs_to_doc_${p._key}`,
				_from: `paragraphs/${p._key}`,
				_to: `documents/${p.document_id}`,
				type: 'belongs_to'
			});
		}
	});

	// Build section -> table edges (contains_table)
	sampleTables.forEach(t => {
		if (t.section_id) {
			edges.push({
				_id: `contains_table/${t._key}`,
				_from: t.section_id,
				_to: `tables/${t._key}`,
				type: 'contains_table'
			});
			// Reverse belongs_to
			edges.push({
				_id: `belongs_to_doc_${t._key}`,
				_from: `tables/${t._key}`,
				_to: `documents/${t.document_id}`,
				type: 'belongs_to'
			});
		}
	});

	return edges;
}
