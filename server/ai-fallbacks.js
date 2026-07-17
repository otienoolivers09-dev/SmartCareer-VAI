function pickFirstDefined(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    return value;
  }
  return '';
}

function normalizeSkills(skills) {
  if (Array.isArray(skills)) {
    return skills.map(item => String(item).trim()).filter(Boolean);
  }
  if (typeof skills === 'string') {
    return skills.split(',').map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function resolveGenerationContext(payload = {}) {
  const rawSkills = normalizeSkills(payload.skills || payload.skillSet || payload.promptSkills || []);
  const experience = pickFirstDefined(payload.experience, payload.summary, payload.cv, payload.context, 'Relevant experience and professional strengths');
  const fullName = pickFirstDefined(payload.fullName, payload.name, 'Candidate');
  const jobTarget = pickFirstDefined(payload.jobTarget, payload.careerGoal, payload.targetRole, payload.role, payload.position, 'Professional role');
  return {
    fullName: String(fullName).trim() || 'Candidate',
    jobTarget: String(jobTarget).trim() || 'Professional role',
    skills: rawSkills.length ? rawSkills : ['Communication', 'Problem solving', 'Teamwork'],
    experience: String(experience).trim() || 'Relevant experience and professional strengths',
    summary: pickFirstDefined(payload.summary, payload.profileSummary, '')
  };
}

function buildFallbackCoverLetter(context) {
  const fullName = context.fullName || 'Candidate';
  const jobTarget = context.jobTarget || 'Professional role';
  const skills = context.skills.length ? context.skills.join(', ') : 'communication, leadership, and problem solving';
  return `${fullName}\n\nDear Hiring Manager,\n\nI am excited to apply for the ${jobTarget} role. I bring a strong mix of professionalism, adaptability, and a results-focused mindset that allows me to contribute quickly and add value from day one. My background has equipped me with strengths in ${skills}, and I am confident in my ability to support your team and deliver meaningful results.\n\nI would welcome the opportunity to discuss how my experience and approach can support your organization’s goals. Thank you for your time and consideration.\n\nSincerely,\n${fullName}`;
}

function buildFallbackLinkedInSummary(context) {
  const fullName = context.fullName || 'Candidate';
  const jobTarget = context.jobTarget || 'Professional role';
  const skills = context.skills.length ? context.skills.join(', ') : 'communication, leadership, and problem solving';
  return `${fullName} is a motivated professional focused on building a strong career in ${jobTarget}. With a commitment to continuous growth and a practical approach to work, ${fullName} combines ${skills} with a strong desire to contribute to meaningful projects and long-term team success.`;
}

function buildFallbackCareerRoadmap(context) {
  const jobTarget = context.jobTarget || 'Professional role';
  const skills = context.skills.length ? context.skills.join(', ') : 'core professional skills';
  return `Career roadmap for ${jobTarget}\n\n1. Strengthen your core profile by aligning your CV, LinkedIn, and portfolio around ${jobTarget}.\n2. Build credibility through one relevant project, certification, or measurable achievement.\n3. Develop and showcase ${skills} in your day-to-day work and public profile.\n4. Apply for 5-10 roles per week and tailor each application to the job description.\n5. Prepare for interviews by practicing STAR stories and role-specific questions.`;
}

function buildFallbackInterviewTips(context) {
  const jobTarget = context.jobTarget || 'Professional role';
  const skills = context.skills.length ? context.skills.join(', ') : 'communication and adaptability';
  return `Interview preparation for ${jobTarget}\n\n- Prepare 5 examples that show ${skills} in action.\n- Use the STAR format to explain your impact and results clearly.\n- Research the company and connect your experience to its goals.\n- Prepare thoughtful questions about the role, team, and success metrics.`;
}

function buildFallbackHealthAnalysis(cvText = '') {
  const text = String(cvText || '').trim();
  const score = text.length > 300 ? 78 : 65;
  return {
    overall: score,
    summary: score >= 75 ? 'Strong foundation with room for stronger quantification.' : 'This CV would benefit from clearer structure and stronger impact statements.',
    skills: 74,
    experience: 72,
    education: 80,
    ats_compatibility: 76,
    improvements: [
      'Add measurable achievements to each role.',
      'Use stronger action verbs and clearer section headings.',
      'Include role-specific keywords from the target job description.'
    ]
  };
}

function buildFallbackSkillsAnalysis(cvText = '', jobRole = '') {
  return {
    user_skills: ['Communication', 'Teamwork', 'Problem solving'],
    required_skills: [jobRole ? `${jobRole} experience` : 'Role-specific experience', 'Project management', 'Stakeholder communication'],
    missing_skills: ['Project management', 'Role-specific certifications'],
    learning_path: ['Complete one practical certification', 'Add one measurable project to your portfolio']
  };
}

export {
  pickFirstDefined,
  normalizeSkills,
  resolveGenerationContext,
  buildFallbackCoverLetter,
  buildFallbackLinkedInSummary,
  buildFallbackCareerRoadmap,
  buildFallbackInterviewTips,
  buildFallbackHealthAnalysis,
  buildFallbackSkillsAnalysis
};
