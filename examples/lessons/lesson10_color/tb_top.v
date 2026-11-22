// Тестбенч урока 10, практика 1: «приёмник WS2812» в тестбенче.
// Такт настоящий (27 МГц): у светодиода свои часы, и сверяем мы
// настоящие наносекунды с даташитом. Меряем каждый высокий импульс:
// длиннее 600 нс — «1», короче — «0». 24 бита — кадр, печатаем G R B.
`timescale 1ns / 100ps

module tb_top;
    // Допуски из даташита WS2812B V5 (самые строгие из найденных), нс.
    localparam real T0H_MIN = 220.0,  T0H_MAX = 380.0;
    localparam real T1H_MIN = 580.0,  T1H_MAX = 1000.0;
    localparam real BIT_MIN = 1250.0;     // TH + TL (из WS2812B-2020 V6)
    localparam real RES_MIN = 280_000.0;  // пауза reset: > 280 мкс
    localparam real ONE_NS  = 600.0;      // порог: длиннее — «1»

    reg  clk = 1'b0;
    wire ws;

    always #18.5 clk = ~clk;              // 27 МГц (период 37 нс)

    top dut (.clk(clk), .ws2812(ws));

    // ---------- Приёмник WS2812 ----------
    reg  [23:0] grb;
    integer     nb = 0, frames = 0, errors = 0;
    realtime    t_rise, t_prev = 0.0, t_fall = 0.0, th, gap;
    realtime    th0 = 0.0, th1 = 0.0, tbit = 0.0, pause = 0.0;

    always begin
        @(posedge ws);
        t_rise = $realtime;
        gap = t_rise - t_fall;                    // сколько линия была в 0
        if (nb == 0 && frames > 0) begin          // начало следующего кадра
            pause = gap;
            if (pause < RES_MIN) errors = errors + 1;
        end else if (nb != 0) begin               // внутри кадра
            tbit = t_rise - t_prev;
            if (tbit < BIT_MIN) errors = errors + 1;
            if (gap > 50_000.0) errors = errors + 1;   // кадр оборвался
        end
        t_prev = t_rise;

        @(negedge ws);
        t_fall = $realtime;
        th = t_fall - t_rise;                     // длительность высокого уровня
        if (th > ONE_NS) begin
            grb = {grb[22:0], 1'b1};
            th1 = th;
            if (th < T1H_MIN || th > T1H_MAX) errors = errors + 1;
        end else begin
            grb = {grb[22:0], 1'b0};
            th0 = th;
            if (th < T0H_MIN || th > T0H_MAX) errors = errors + 1;
        end
        nb = nb + 1;

        if (nb == 24) begin                       // кадр собран
            nb = 0;
            frames = frames + 1;
            if (frames == 1)
                $display("кадр %0d: G=%h R=%h B=%h  «0» %0.0f нс, «1» %0.0f нс, бит %0.0f нс",
                         frames, grb[23:16], grb[15:8], grb[7:0], th0, th1, tbit);
            else
                $display("кадр %0d: G=%h R=%h B=%h  пауза перед кадром %0.1f мкс",
                         frames, grb[23:16], grb[15:8], grb[7:0], pause / 1000.0);
            if (grb !== 24'h10_40_00) errors = errors + 1;
        end
    end

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        #10;
        if (ws !== 1'b0) errors = errors + 1;     // в покое линия = 0
        wait (frames == 3);
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end

    initial begin                                 // страховка: кадров нет
        #2_000_000;
        $display("кадров за 2 мс: %0d", frames);
        $display("ТЕСТ НЕ ПРОЙДЕН");
        $finish;
    end
endmodule
