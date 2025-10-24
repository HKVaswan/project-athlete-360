export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, message: "Username or password required" });

    // Search user by either username or email
    const user = await prisma.user.findFirst({
      where: {
        OR: [{ username }, { email: username }],
      },
    });

    if (!user) {
      console.log("[LOGIN] ❌ No user found for:", username);
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      console.log("[LOGIN] ❌ Invalid password for:", username);
      return res.status(400).json({ success: false, message: "Invalid credentials" });
    }

    console.log("[LOGIN] ✅ Successful login for:", user.username);

    // Optional: return limited safe user data
    return res.json({
      success: true,
      message: "Login successful",
      data: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("[LOGIN] ❌ Login failed:", err);
    logger.error("Login failed: " + err);
    return res.status(500).json({ success: false, message: "Server error during login" });
  }
};