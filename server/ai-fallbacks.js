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

function buildProfessionalCvText(payload = {}) {
  const cvType = String(payload.cvType || 'standard').toLowerCase();
  const isInternational = cvType.includes('international');
  const fullName = payload.fullName || 'YOUR FULL NAME';
  const email = payload.email || 'your.email@example.com';
  const phone = payload.phone || '+254700000000';
  const city = payload.city || 'City';
  const country = payload.country || 'Country';
  const summary = payload.summary || 'Results-driven professional with a strong track record of delivering measurable impact and continuous improvement.';
  const skills = Array.isArray(payload.skills) && payload.skills.length
    ? payload.skills
    : ['Communication', 'Leadership', 'Problem Solving'];
  const experience = Array.isArray(payload.experience) && payload.experience.length
    ? payload.experience
    : [{ title: 'Professional Role', company: 'Organization', location: city, period: 'YYYY - Present', details: ['Delivered high-quality work with measurable impact.', 'Collaborated effectively with colleagues and stakeholders.'] }];
  const education = Array.isArray(payload.education) && payload.education.length
    ? payload.education
    : [{ school: 'University Name', degree: 'Degree / Field', period: 'YYYY - YYYY' }];
  const certifications = Array.isArray(payload.certifications) && payload.certifications.length
    ? payload.certifications
    : [{ name: 'Professional Certificate', issuer: 'Issuing Institution', year: 'YYYY' }];

  const lines = [];
  lines.push(fullName);
  lines.push(`${email} | ${phone} | ${city}, ${country}`);
  lines.push('');
  lines.push('=======================================');
  lines.push('PROFESSIONAL SUMMARY');
  lines.push('=======================================');
  lines.push(summary);
  lines.push('');
  lines.push('=======================================');
  lines.push('CORE COMPETENCIES');
  lines.push('=======================================');
  skills.forEach(skill => lines.push(`- ${skill}`));
  lines.push('');
  lines.push('=======================================');
  lines.push('PROFESSIONAL EXPERIENCE');
  lines.push('=======================================');
  experience.forEach((item) => {
    const title = item.title || 'Role';
    const company = item.company || 'Organization';
    const location = item.location || city;
    const period = item.period || 'YYYY - Present';
    const details = Array.isArray(item.details) && item.details.length ? item.details : ['Delivered measurable results and supported team objectives.'];
    lines.push(`${company} | ${title} | ${location} | ${period}`);
    details.forEach(detail => lines.push(`- ${detail}`));
    lines.push('');
  });
  lines.push('=======================================');
  lines.push('EDUCATION');
  lines.push('=======================================');
  education.forEach((item) => {
    const school = item.school || 'School Name';
    const degree = item.degree || 'Degree / Field';
    const period = item.period || 'YYYY - YYYY';
    lines.push(`${school} | ${degree} | ${period}`);
  });
  lines.push('');
  lines.push('=======================================');
  lines.push('CERTIFICATIONS');
  lines.push('=======================================');
  certifications.forEach((item) => {
    const name = item.name || 'Certification';
    const issuer = item.issuer || 'Issuer';
    const year = item.year || 'YYYY';
    lines.push(`${name} | ${issuer} | ${year}`);
  });
  lines.push('');
  if (isInternational) {
    lines.push('LANGUAGES');
    lines.push('English | Fluent');
    lines.push('');
  }
  lines.push('REFERENCES AVAILABLE UPON REQUEST');
  return lines.join('\n').trim();
}

function buildProfessionalCoverLetter(payload = {}) {
  const fullName = payload.fullName || 'Candidate Name';
  const companyName = payload.companyName || 'Hiring Organization';
  const companyAddress = payload.companyAddress || '';
  const jobTitle = payload.jobTitle || payload.jobTarget || 'Professional Role';
  const skills = Array.isArray(payload.skills) && payload.skills.length
    ? payload.skills
    : ['communication', 'problem solving', 'team collaboration'];
  const summary = payload.summary || 'I am excited to contribute my experience and dedication to your team.';

  const addressBlock = companyAddress ? `${companyName}\n${companyAddress}` : companyName;
  return `${fullName}\n\n${addressBlock}\n\nDear Hiring Manager,\n\n${summary} I am excited to apply for the ${jobTitle} position and bring a strong mix of ${skills.join(', ')} to your organization. My background has prepared me to contribute with professionalism, initiative, and measurable impact from the outset.\n\nI would welcome the opportunity to discuss how my experience can support your team and help advance your organization’s goals. Thank you for your time and consideration.\n\nSincerely,\n${fullName}`;
}

function buildFallbackCoverLetter(context) {
  const fullName = context.fullName || 'Candidate';
  const jobTarget = context.jobTarget || 'Professional role';
  const skills = context.skills.length ? context.skills.join(', ') : 'communication, leadership, and problem solving';
  return buildProfessionalCoverLetter({
    fullName,
    companyName: context.companyName || 'Hiring Organization',
    companyAddress: context.companyAddress || '',
    jobTitle: jobTarget,
    skills: Array.isArray(context.skills) ? context.skills : [skills],
    summary: `I am excited to apply for the ${jobTarget} role. I bring a strong mix of professionalism, adaptability, and a results-focused mindset that allows me to contribute quickly and add value from day one. My background has equipped me with strengths in ${skills}, and I am confident in my ability to support your team and deliver meaningful results.`
  });
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
  buildProfessionalCvText,
  buildProfessionalCoverLetter,
  buildFallbackCoverLetter,
  buildFallbackLinkedInSummary,
  buildFallbackCareerRoadmap,
  buildFallbackInterviewTips,
  buildFallbackHealthAnalysis,
  buildFallbackSkillsAnalysis
};
