"use client";

import { useState, useEffect, useRef } from "react";
import { Button } from "./Button";
import { InterviewChat } from "./InterviewChat";
import { cn } from "../lib/utils";
import { MicrophoneIcon, PauseIcon, XMarkIcon, ClockIcon, StopIcon } from "@heroicons/react/24/solid";
import { generateInterviewResponse, generateInterviewFeedback } from "../lib/client-ai";
import { transcribeAudio, textToSpeech, stopSpeech, initSpeechSynthesis, cleanupSpeechSynthesis, forceVoiceInit } from "../lib/voice";

type Message = {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date;
};

type InterviewSessionProps = {
  topic: string;
  sessionType?: "mock" | "topic" | "qa" | "language" | string;
  onEnd: (feedback: { summary: string; strengths: string[]; improvements: string[] }) => void;
  className?: string;
  details?: any;
  notes?: string;
};

export function InterviewSession({ topic, sessionType = "mock", onEnd, className, details = {}, notes = "" }: InterviewSessionProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [userInput, setUserInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [audioRecorder, setAudioRecorder] = useState<MediaRecorder | null>(null);
  const [audioChunks, setAudioChunks] = useState<Blob[]>([]);
  const [isEndingInterview, setIsEndingInterview] = useState(false);
  const [interviewTime, setInterviewTime] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [speechRecognition, setSpeechRecognition] = useState<any>(null);
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  
  // Initialize with welcome message based on session type
  useEffect(() => {
    let welcomeMessage = `Hello! I'll be interviewing you about ${topic} today. Click "Connect" to begin our conversation.`;
    
    if (sessionType === "topic") {
      welcomeMessage = `Welcome to your lecture on ${topic}. Click "Connect" to begin our session. I'll start with an overview and then we'll dive into the details.`;
    } else if (sessionType === "qa") {
      welcomeMessage = `Welcome to your Q&A session on ${topic}. Click "Connect" to begin. I'll be testing your knowledge with a series of questions.`;
    } else if (sessionType === "language") {
      welcomeMessage = `Bonjour! Welcome to your language practice session. Click "Connect" to begin. Today we'll be practicing ${topic}.`;
    }
    
    setMessages([
      {
        id: "welcome",
        content: welcomeMessage,
        role: "assistant",
        timestamp: new Date(),
      }
    ]);
  }, [topic, sessionType]);

  // Initialize speech synthesis when the component loads
  useEffect(() => {
    console.log('Initializing speech synthesis for interview session...');
    if ('speechSynthesis' in window) {
      // Initialize voice capabilities
      initSpeechSynthesis();
      
      // Use the enhanced voice initialization
      setTimeout(async () => {
        try {
          console.log('Trying force voice initialization...');
          const success = await forceVoiceInit();
          console.log('Force voice initialization result:', success);
          
          if (success) {
            // Test voice with a single word silently to ensure it's working
            const testUtterance = new SpeechSynthesisUtterance('Test');
            testUtterance.volume = 0; // Silent test
            window.speechSynthesis.speak(testUtterance);
          }
        } catch (e) {
          console.error('Voice initialization error:', e);
        }
      }, 500);
      
      // Cleanup on unmount
      return () => {
        console.log('Cleaning up speech synthesis...');
        cleanupSpeechSynthesis();
      };
    } else {
      console.error('Speech synthesis not available in this browser');
    }
  }, []);
  
  // Start the interview timer once connected
  useEffect(() => {
    if (isConnected) {
      timerRef.current = setInterval(() => {
        setInterviewTime(prev => prev + 1);
      }, 1000);
    }
    
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [isConnected]);
  
  // Setup speech recognition
  useEffect(() => {
    // Initialize speech recognition
    const SpeechRecognition = (window as any).SpeechRecognition || 
                              (window as any).webkitSpeechRecognition;
    
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      
      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }
        
        if (finalTranscript) {
          setLiveTranscript(finalTranscript);
        } else if (interimTranscript) {
          setLiveTranscript(interimTranscript);
        }
      };
      
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
      };
      
      recognitionRef.current = recognition;
      setSpeechRecognition(recognition);
    }
    
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore errors when stopping
        }
      }
    };
  }, []);
  
  // Format timer display
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };
  
  const setupAudioRecording = async () => {
    try {
      if (!navigator.mediaDevices) {
        throw new Error("Media devices not available in this browser or context");
      }
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      
      recorder.addEventListener('dataavailable', handleDataAvailable);
      recorder.addEventListener('stop', handleRecordingStop);
      
      setAudioRecorder(recorder);
      setIsConnected(true);
      
      // Start the interview with an introduction
      setTimeout(() => startInterview(), 1000);
    } catch (error) {
      console.error("Error setting up audio recording:", error);
      alert("Could not access microphone. Voice input will not be available.");
      
      // Still set connected so the interview can proceed without voice
      setIsConnected(true);
      setTimeout(() => startInterview(), 1000);
    }
  };
  
  const startInterview = async () => {
    try {
      setIsLoading(true);
      
      // Find the most appropriate introduction based on session type
      let introMessage = `Great! Let's start our interview about ${topic}. I'll ask you some questions about ${topic} and you can respond either by speaking or typing your answers.`;
      
      // Get the right introduction for the session type
      if (sessionType === "topic") {
        introMessage = `Welcome to your lecture on ${topic}. I'll start with an overview and then we'll dive into the details. Feel free to ask questions at any point.`;
      } else if (sessionType === "qa") {
        introMessage = `Welcome to your Q&A session on ${topic}. I'll be testing your knowledge with a series of questions. Let's see how much you know about ${topic}!`;
      } else if (sessionType === "language") {
        introMessage = `Bonjour! Welcome to your language practice session. Today we'll be practicing ${topic}. I'll speak in the language we're practicing, and you can respond to improve your skills.`;
      } else if (sessionType === "mock") {
        // For mock interviews, use the details to customize the intro
        const role = details.role || topic;
        const company = details.company || "a company";
        const experience = details.experience || "this role";
        const specificSkills = details.specificSkills || "";
        
        // Create a mock interview introduction
        introMessage = `Welcome to your mock interview for the ${role} position at ${company}. I'll be your interviewer today. I'll ask you questions related to ${topic} and your experience with ${experience}.`;
        
        if (specificSkills) {
          introMessage += ` I'll focus particularly on your skills with ${specificSkills}.`;
        }
        
        introMessage += ` Let's begin!`;
      }
      
      // Save interview session data to sessionStorage for easy access
      const sessionData = {
        id: Date.now().toString(),
        topic,
        type: sessionType,
        startTime: new Date().toISOString(),
      };
      
      sessionStorage.setItem('interviewSession', JSON.stringify(sessionData));
      
      // Add introduction message to the chat
      const introMsg: Message = {
        id: Date.now().toString(),
        content: introMessage,
        role: "assistant",
        timestamp: new Date(),
      };
      
      setMessages(prev => [...prev, introMsg]);
      
      // Try to save the session to the database
      try {
        const response = await fetch('/api/create-interview', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            topic,
            type: sessionType,
            notes,
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          
          // Update the session data with the database ID
          if (data.id) {
            sessionData.id = data.id;
            sessionStorage.setItem('interviewSession', JSON.stringify(sessionData));
          }
        }
      } catch (e) {
        // Silently fail - we don't want to interrupt the interview flow
        console.error('Error saving session:', e);
      }
      
      // Speak the introduction - FIXED: Use a more explicit approach
      console.log('Starting to speak introduction...');
      
      // Give UI time to update before speaking
      setTimeout(async () => {
        try {
          // Make sure voices are ready
          await forceVoiceInit();
          
          // Directly use speechSynthesis for more reliable behavior
          const utterance = new SpeechSynthesisUtterance(introMessage);
          utterance.rate = speechRate;
          
          // Set voice if available
          if (window.speechSynthesis.getVoices().length > 0) {
            // Use the first English voice available
            const voices = window.speechSynthesis.getVoices();
            const englishVoice = voices.find(v => 
              v.lang === 'en-US' || v.lang.startsWith('en')
            );
            if (englishVoice) utterance.voice = englishVoice;
          }
          
          // Mark as speaking
          setIsSpeaking(true);
          
          // Set up event handlers
          utterance.onend = () => {
            setIsSpeaking(false);
            console.log('Introduction speech completed');
          };
          
          utterance.onerror = (e) => {
            console.error('Error during introduction speech:', e);
            setIsSpeaking(false);
          };
          
          // Speak the introduction
          window.speechSynthesis.speak(utterance);
          
          // Ensure it's not paused (Chrome bug)
          window.speechSynthesis.resume();
        } catch (err) {
          console.error('Error in speak introduction:', err);
          setIsSpeaking(false);
        }
      }, 800);
      
    } catch (error) {
      console.error("Error starting interview:", error);
      alert("There was an error starting the interview. Please try again later.");
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleDataAvailable = (event: BlobEvent) => {
    if (event.data.size > 0) {
      audioChunksRef.current.push(event.data);
    }
  };
  
  const handleRecordingStop = async () => {
    const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/wav' });
    audioChunksRef.current = [];
    
    try {
      setIsLoading(true);
      const transcription = await transcribeAudio(audioBlob);
      setIsLoading(false);
      
      if (transcription) {
        setUserInput(transcription);
        setTranscript(transcription);
        // Automatically send the message after transcription is complete
        handleSendMessage(transcription);
      } else {
        setUserInput(""); // No transcription available
      }
    } catch (error) {
      console.error("Error transcribing audio:", error);
      alert("There was an error processing your speech. Please try again or use text input.");
      setIsLoading(false);
    }
  };
  
  const startListening = () => {
    if (!audioRecorder) {
      alert("Microphone is not available. Please try again or use text input.");
      return;
    }
    
    // Don't start listening if AI is speaking
    if (isSpeaking) return;
    
    setIsListening(true);
    setTranscript("");
    setLiveTranscript("");
    
    // Start speech recognition for live transcription
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error('Failed to start recognition:', e);
      }
    }
    
    // Also start audio recording for backup transcription with AssemblyAI
    audioChunksRef.current = [];
    audioRecorder.start();
  };
  
  const stopListening = () => {
    // Stop speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error('Failed to stop recognition:', e);
      }
    }
    
    // Stop audio recorder
    if (audioRecorder && audioRecorder.state === 'recording') {
      audioRecorder.stop();
    }
    
    setIsListening(false);
    
    // Don't clear the transcript here - we'll use it for the message
  };
  
  // Speech rate control and speech handling
  const handleSpeechRateChange = (newRate: number) => {
    setSpeechRate(newRate);
    // If currently speaking, update the rate immediately
    if (isSpeaking) {
      setSpeechRate(newRate);
    }
  };
  
  // Function to play audio response with speech rate control - FIXED for more reliable behavior
  const playAudioResponse = async (text: string) => {
    if (!text || !isConnected) return;
    
    console.log('PlayAudioResponse called with text length:', text.length);
    setIsSpeaking(true);
    
    try {
      console.log('Starting text-to-speech for AI response...');
      
      // Ensure voices are ready
      await forceVoiceInit();
      
      // Direct approach to speech synthesis for more reliability
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = speechRate;
      
      // Set voice if available
      if (window.speechSynthesis.getVoices().length > 0) {
        // Use the first English voice available
        const voices = window.speechSynthesis.getVoices();
        const englishVoice = voices.find(v => 
          v.lang === 'en-US' || v.lang.startsWith('en')
        );
        if (englishVoice) utterance.voice = englishVoice;
      }
      
      // Set up event handlers
      utterance.onend = () => {
        setIsSpeaking(false);
        console.log('AI response speech completed');
      };
      
      utterance.onerror = (e) => {
        console.error('Error during AI response speech:', e);
        setIsSpeaking(false);
      };
      
      // First make sure any current speech is stopped
      window.speechSynthesis.cancel();
      
      // Speak the text
      window.speechSynthesis.speak(utterance);
      
      // Ensure it's not paused (Chrome bug)
      window.speechSynthesis.resume();
      
      console.log('Speech synthesis request sent to browser');
      
    } catch (error) {
      console.error("Error playing audio:", error);
      setIsSpeaking(false);
    }
  };
  
  // Function to stop speaking immediately
  const stopSpeaking = () => {
    if ('speechSynthesis' in window && isSpeaking) {
      stopSpeech();
      setIsSpeaking(false);
    }
  };
  
  const handleSendMessage = async (transcribedText?: string) => {
    let textToSend = '';
    
    // Prioritize the live transcript if it exists
    if (liveTranscript) {
      textToSend = liveTranscript;
    } else if (transcribedText) {
      textToSend = transcribedText;
    } else {
      textToSend = userInput;
    }
    
    if (!textToSend.trim()) return;
    
    // Add user message
    const newUserMessage: Message = {
      id: Date.now().toString(),
      content: textToSend.trim(),
      role: "user",
      timestamp: new Date()
    };
    
    setMessages((prev) => [...prev, newUserMessage]);
    setUserInput("");
    setTranscript("");
    setLiveTranscript("");
    setIsLoading(true);
    
    // Save the user message to Convex if we have an ID
    const sessionData = JSON.parse(sessionStorage.getItem('interviewSession') || '{}');
    if (sessionData?.id) {
      try {
        // Wrap in a try-catch to prevent API errors from affecting voice
        fetch('/api/save-message', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            interviewId: sessionData.id,
            content: newUserMessage.content,
            role: 'user',
          }),
        }).catch(e => {
          // Just log the error, don't let it affect the main flow
          console.warn('API error when saving message, continuing anyway:', e);
        });
      } catch (e) {
        // Silently fail - we don't want to interrupt the interview flow
        console.error('Error saving message:', e);
      }
    }
    
    // AI is thinking
    setIsThinking(true);
    
    try {
      // Convert messages for AI format
      const aiMessages = messages.map(msg => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      }));
      
      // Add the new user message
      aiMessages.push({
        role: 'user',
        content: newUserMessage.content
      });
      
      // Enhanced context for the AI to stay focused on the interview type
      const interviewFocus = 
        details?.focusAreas?.join(',').toLowerCase().includes('system design')
          ? 'system design interview'
          : details?.focusAreas?.join(',').toLowerCase().includes('leetcode') || 
            details?.focusAreas?.join(',').toLowerCase().includes('coding')
            ? 'coding interview with algorithm problems'
            : details?.focusAreas?.join(',').toLowerCase().includes('react') || 
              details?.focusAreas?.join(',').toLowerCase().includes('front')
              ? 'front-end development interview'
              : details?.focusAreas?.join(',').toLowerCase().includes('back')
                ? 'back-end development interview'
                : `${sessionType} interview`;
      
      // Create a focused context with clear instructions
      const contextEnhancedSessionType = sessionType === 'mock'
        ? `You are an expert interviewer conducting a ${interviewFocus} for the position of ${topic}. 
           Stay strictly focused on ${details?.focusAreas?.join(', ') || topic} without getting sidetracked by personal details. 
           Ask technical questions appropriate for a ${details?.experience || 'mid-level'} position.
           ${notes ? 'ADDITIONAL CONTEXT (not to be mentioned directly): ' + notes : ''}`
        : sessionType;
      
      // Generate AI response with the enhanced context
      const aiResponseText = await generateInterviewResponse(
        aiMessages,
        contextEnhancedSessionType,
        topic
      );
      
      // Add AI response to messages
      const aiResponse: Message = {
        id: Date.now().toString(),
        content: aiResponseText,
        role: "assistant",
        timestamp: new Date()
      };
      
      setMessages((prev) => [...prev, aiResponse]);
      
      // Save the AI response to Convex if we have an ID
      if (sessionData?.id) {
        try {
          // Wrap in a try-catch to prevent API errors from affecting voice
          fetch('/api/save-message', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              interviewId: sessionData.id,
              content: aiResponseText,
              role: 'assistant',
            }),
          }).catch(e => {
            // Just log the error, don't let it affect the main flow
            console.warn('API error when saving AI message, continuing anyway:', e);
          });
        } catch (e) {
          // Silently fail - we don't want to interrupt the interview flow
          console.error('Error saving AI message:', e);
        }
      }
      
      // Play audio feedback for the AI response
      setIsThinking(false);
      setIsLoading(false);
      
      // Use setTimeout to give the UI a chance to update before starting speech
      setTimeout(() => {
        // Make sure any ongoing speech is stopped
        if (window.speechSynthesis && window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel();
        }
        
        // Now play the new response
        playAudioResponse(aiResponseText)
          .catch(err => console.error('Error playing AI response audio:', err));
      }, 500); // Longer delay for UI to fully update
    } catch (error) {
      console.error("Error generating AI response:", error);
      
      // Add error message
      const errorMessage: Message = {
        id: Date.now().toString(),
        content: "I'm sorry, I'm having trouble responding right now. Let's continue our conversation.",
        role: "assistant",
        timestamp: new Date()
      };
      
      setMessages((prev) => [...prev, errorMessage]);
      setIsThinking(false);
      setIsLoading(false);
    }
  };
  
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };
  
  const handleEndInterview = async () => {
    // Don't allow multiple clicks on end button
    if (isEndingInterview) return;
    setIsEndingInterview(true);
    
    // Stop any ongoing speech
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
    
    // Stop any ongoing recording
    if (audioRecorder && audioRecorder.state === 'recording') {
      audioRecorder.stop();
    }
    
    // Stop the timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
    }
    
    const aiMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant', 
      content: msg.content
    }));
    
    try {
      setIsThinking(true);
      
      // Generate feedback using the API
      const feedback = await generateInterviewFeedback(
        aiMessages,
        sessionType,
        topic
      );
      
      // Save feedback to Convex
      const sessionData = JSON.parse(sessionStorage.getItem('interviewSession') || '{}');
      if (sessionData?.id) {
        try {
          await fetch('/api/save-feedback', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              interviewId: sessionData.id,
              feedback,
            }),
          });
        } catch (e) {
          console.error('Error saving feedback:', e);
        }
      }
      
      onEnd(feedback);
    } catch (error) {
      console.error("Error generating feedback:", error);
      
      // Fallback feedback if there's an error
      const fallbackFeedback = {
        summary: `You participated in this ${sessionType} about ${topic}.`,
        strengths: [
          `Engaged in the ${sessionType}`,
          "Provided responses to questions",
          "Completed the session"
        ],
        improvements: [
          "Technical issues prevented detailed feedback",
          "Try another session with a different connection",
          "Consider trying a different topic"
        ]
      };
      
      // Try to save fallback feedback
      const sessionData = JSON.parse(sessionStorage.getItem('interviewSession') || '{}');
      if (sessionData?.id) {
        try {
          await fetch('/api/save-feedback', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              interviewId: sessionData.id,
              feedback: fallbackFeedback,
            }),
          });
        } catch (e) {
          console.error('Error saving fallback feedback:', e);
        }
      }
      
      onEnd(fallbackFeedback);
    } finally {
      setIsThinking(false);
      setIsEndingInterview(false);
    }
  };
  
  const handleConnect = () => {
    setupAudioRecording();
  };
  
  // Function to test voice capabilities
  const testVoice = async () => {
    console.log("Testing voice...");
    setIsSpeaking(true);
    
    try {
      // First ensure voices are properly initialized
      await forceVoiceInit();
      
      // Test message that's similar to the real interview intro
      const testMessage = "Hello, this is a test of the voice system. If you can hear this, the voice system is working correctly.";
      
      // Use the same direct approach as the real interview
      const utterance = new SpeechSynthesisUtterance(testMessage);
      utterance.rate = speechRate;
      
      // Set voice if available
      if (window.speechSynthesis.getVoices().length > 0) {
        const voices = window.speechSynthesis.getVoices();
        const englishVoice = voices.find(v => 
          v.lang === 'en-US' || v.lang.startsWith('en')
        );
        if (englishVoice) utterance.voice = englishVoice;
      }
      
      // Set up event handlers
      utterance.onend = () => {
        setIsSpeaking(false);
        console.log('Test voice completed successfully');
      };
      
      utterance.onerror = (e) => {
        console.error('Error during test voice:', e);
        setIsSpeaking(false);
        alert("Voice test failed. Your browser may not fully support speech synthesis. Try using Chrome for the best experience.");
      };
      
      // Cancel any existing speech
      window.speechSynthesis.cancel();
      
      // Speak the test
      window.speechSynthesis.speak(utterance);
      
      // Ensure it's not paused (Chrome bug)
      window.speechSynthesis.resume();
      
    } catch (e) {
      console.error("Voice test failed:", e);
      setIsSpeaking(false);
      alert("Voice test failed. Your browser may not fully support speech synthesis. Try using Chrome for the best experience.");
    }
  };
  
  const renderMessage = (message: Message) => (
    <div
      key={message.id}
      className={cn(
        "flex items-start gap-3 p-4 rounded-lg max-w-[85%] mb-3",
        message.role === "assistant"
          ? "self-start bg-gray-100"
          : "self-end bg-indigo-600 text-white"
      )}
    >
      {message.role === "assistant" && (
        <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-xl">
          {sessionType === "topic" ? "👩‍🏫" : "👩‍💼"}
        </div>
      )}
      <div className="flex flex-col">
        <div className={cn("text-sm", message.role === "assistant" ? "text-gray-800" : "text-white")}>
          {message.content}
        </div>
        <div className={cn("text-xs mt-1", 
          message.role === "assistant" ? "text-gray-500" : "text-indigo-100"
        )}>
          {message.timestamp.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
      {message.role === "user" && (
        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-xl">
          👤
        </div>
      )}
    </div>
  );
  
  const getSessionTitle = () => {
    switch (sessionType) {
      case "topic":
        return `Topic Lecture: ${topic}`;
      case "qa":
        return `Q&A Session: ${topic}`;
      case "language":
        return `Language Practice: ${topic}`;
      default:
        return `Interview: ${topic}`;
    }
  };
  
  const sendToAI = async (userMessages: Message[]): Promise<string> => {
    // Only the most recent 15 messages to keep context reasonably sized
    const recentMessages = userMessages.slice(-15);
    
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: recentMessages,
          interviewType: sessionType,
          topic,
          action: 'response',
          notes,
          details,
        }),
      });
      
      if (!response.ok) {
        throw new Error(`AI response error: ${response.status}`);
      }
      
      const data = await response.json();
      return data.response;
    } catch (error) {
      console.error('Error getting AI response:', error);
      return "I apologize, but I'm experiencing technical difficulties. Let's try again.";
    }
  };
  
  return (
    <div className={cn("flex flex-col h-full bg-white rounded-xl shadow-lg overflow-hidden", className)}>
      <div className="p-4 border-b flex justify-between items-center bg-indigo-50">
        <h2 className="text-lg font-medium text-indigo-800">
          {getSessionTitle()}
        </h2>
        <div className="flex items-center gap-3">
          {isConnected && (
            <>
              {/* Speech rate controls - FIXED: Updated colors for better visibility */}
              <div className="flex items-center space-x-2">
                <button
                  onClick={stopSpeaking}
                  className={`p-1 rounded ${isSpeaking ? 'bg-red-100 text-red-800 hover:bg-red-200' : 'bg-gray-100 text-gray-400'}`}
                  disabled={!isSpeaking}
                  aria-label="Stop speaking"
                  title="Skip AI speaking"
                >
                  <StopIcon className="h-4 w-4" />
                </button>
                
                <div className="flex items-center">
                  <span className="text-xs text-gray-700 mr-1 font-medium">Speed:</span>
                  <select
                    value={speechRate}
                    onChange={(e) => handleSpeechRateChange(parseFloat(e.target.value))}
                    className="text-xs bg-indigo-100 border border-indigo-200 rounded px-2 py-1 text-gray-800"
                  >
                    <option value="0.8">Slow</option>
                    <option value="1.0">Normal</option>
                    <option value="1.3">Fast</option>
                    <option value="1.6">Faster</option>
                    <option value="2.0">Fastest</option>
                  </select>
                </div>
              </div>
            
              <div className="flex items-center gap-1 text-indigo-700 font-medium">
                <ClockIcon className="h-4 w-4" />
                <span>{formatTime(interviewTime)}</span>
              </div>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleEndInterview}
            disabled={isEndingInterview || !isConnected}
            className={cn(
              "text-gray-500 hover:text-gray-700",
              isEndingInterview && "opacity-50 cursor-not-allowed"
            )}
          >
            <XMarkIcon className="w-5 h-5" />
          </Button>
        </div>
      </div>
      
      <div className="flex flex-1 overflow-hidden">
        <div className="w-2/3 border-r flex flex-col">
          <div className="flex-1 overflow-hidden flex flex-col">
            <div className="flex flex-col space-y-1 p-4 h-full overflow-y-auto">
              {messages.map(renderMessage)}
            </div>
            
            <div className="p-4 border-t">
              {!isConnected ? (
                <div className="w-full h-[600px] flex flex-col items-center justify-center p-6">
                  <h1 className="text-2xl font-bold mb-4">{getSessionTitle()}</h1>
                  <p className="text-lg mb-8">{messages[0]?.content}</p>
                  <div className="flex flex-col space-y-4">
                    <Button 
                      onClick={handleConnect} 
                      className="px-8 py-4"
                    >
                      Connect
                    </Button>
                    <Button 
                      onClick={testVoice} 
                      className="px-8 py-2 bg-gray-700 hover:bg-gray-600"
                      disabled={isSpeaking}
                    >
                      {isSpeaking ? "Testing Voice..." : "Test Voice"}
                    </Button>
                    {isSpeaking && (
                      <div className="flex flex-col items-center space-y-2 mt-2">
                        <div className="flex items-center justify-center space-x-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                          <span className="text-sm">Speaking now... You should hear audio</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                          If you don't hear anything, check your system volume and browser permissions.
                          <br />
                          Speech synthesis works best in Chrome and Safari.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  {transcript && (
                    <div className="mb-2 p-2 bg-gray-50 rounded text-sm text-gray-700">
                      <p className="font-semibold text-xs mb-1">Transcript:</p>
                      {transcript}
                    </div>
                  )}
                  {liveTranscript && (
                    <div className="mb-2 p-2 bg-gray-50 border border-indigo-100 rounded text-sm text-gray-700">
                      <p className="font-semibold text-xs mb-1 flex items-center">
                        <span className="w-2 h-2 bg-indigo-600 rounded-full animate-pulse mr-1"></span>
                        Live Transcript:
                      </p>
                      {liveTranscript}
                    </div>
                  )}
                  <div className="flex items-center space-x-2">
                    <textarea
                      value={userInput}
                      onChange={(e) => setUserInput(e.target.value)}
                      onKeyDown={handleKeyPress}
                      placeholder={isListening ? "Listening..." : isSpeaking ? "AI is speaking..." : "Type your response..."}
                      className="flex-1 p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      rows={2}
                      disabled={isLoading || isListening || isSpeaking}
                    />
                    <div className="flex flex-col space-y-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={isListening ? "destructive" : "default"}
                        onClick={isListening ? stopListening : startListening}
                        disabled={isLoading || !audioRecorder || isSpeaking}
                        className={cn(
                          "rounded-full w-10 h-10 p-0 flex items-center justify-center",
                          isListening ? "animate-pulse bg-red-500" : "",
                          isSpeaking ? "opacity-50 cursor-not-allowed" : ""
                        )}
                      >
                        {isListening ? (
                          <PauseIcon className="w-5 h-5" />
                        ) : (
                          <MicrophoneIcon className="w-5 h-5" />
                        )}
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        
        <div className="w-1/3 p-6 flex flex-col items-center justify-center bg-gradient-to-br from-indigo-50 to-purple-50">
          <div className="flex flex-col items-center">
            <div className="w-24 h-24 bg-indigo-100 rounded-full flex items-center justify-center text-5xl mb-4">
              {sessionType === "topic" ? "👩‍🏫" : "👩‍💼"}
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-1">
              {isThinking ? "Thinking..." : isSpeaking ? "Speaking..." : sessionType === "topic" ? "Joanna" : "Joanna"}
            </h3>
            <p className="text-sm text-gray-700 text-center font-medium">
              {isThinking
                ? "Analyzing your response..."
                : isSpeaking
                ? "Please wait until I finish speaking"
                : isConnected
                ? `I'm here to ${sessionType === "topic" ? "teach" : sessionType === "qa" ? "quiz" : "interview"} you about ${topic}`
                : "Click 'Connect' to start our session"}
            </p>
            
            {(isThinking || isSpeaking) && (
              <div className="mt-4 flex space-x-2">
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: "0ms" }}></div>
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: "150ms" }}></div>
                <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style={{ animationDelay: "300ms" }}></div>
              </div>
            )}
            
            {isSpeaking && (
              <div className="mt-4 flex flex-col items-center">
                <div className="flex items-center space-x-2 mb-2">
                  <Button 
                    size="sm" 
                    onClick={stopSpeaking}
                    className="bg-red-500 hover:bg-red-600 text-white"
                  >
                    Skip
                  </Button>
                  <div className="flex items-center space-x-1">
                    <span className="text-xs text-gray-700 font-medium">Speed:</span>
                    <select 
                      value={speechRate}
                      onChange={(e) => handleSpeechRateChange(parseFloat(e.target.value))}
                      className="text-xs border border-gray-300 rounded p-1 bg-white text-gray-800"
                    >
                      <option value="0.8">0.8x</option>
                      <option value="1.0">1.0x</option>
                      <option value="1.2">1.2x</option>
                      <option value="1.5">1.5x</option>
                      <option value="2.0">2.0x</option>
                    </select>
                  </div>
                </div>
              </div>
            )}
            
            {isConnected && !isThinking && !isSpeaking && (
              <Button
                onClick={handleEndInterview}
                disabled={isEndingInterview}
                className={cn(
                  "mt-6 bg-indigo-100 hover:bg-indigo-200 text-indigo-800 px-6 py-2 rounded-lg shadow-sm font-medium",
                  isEndingInterview && "opacity-50 cursor-not-allowed"
                )}
              >
                End Session & Get Feedback
              </Button>
            )}
          </div>
        </div>
      </div>
      
      <div className="absolute bottom-20 right-4 flex flex-col items-end space-y-2">
        {isConnected && (
          <>
            {/* Speaking indicator and stop button - FIXED: Updated colors for visibility */}
            {isSpeaking && (
              <div className="bg-white/90 backdrop-blur-md p-2 rounded-lg shadow-md flex items-center space-x-2 border border-gray-200">
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <span className="text-xs font-medium text-gray-800">Speaking</span>
                </div>
                <button 
                  onClick={stopSpeaking}
                  className="p-1 rounded-full bg-red-500/80 hover:bg-red-500 transition-colors"
                  title="Stop speaking"
                >
                  <StopIcon className="w-4 h-4 text-white" />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
} 