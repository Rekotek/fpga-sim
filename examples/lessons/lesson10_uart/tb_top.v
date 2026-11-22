// Тестбенч урока 10, практика 3: «Mac» набирает клавиши на настоящих
// 115 200 бод, тестбенч ловит эхо и кадры WS2812 и сверяет цвет.
`timescale 1ns / 100ps

module tb_top;
    localparam integer BIT_NS = 8681;     // 1 / 115 200 бод ≈ 8 681 нс

    reg  clk = 1'b0;
    reg  rx  = 1'b1;
    wire tx, ws;

    always #18.5 clk = ~clk;              // 27 МГц

    top dut (.clk(clk), .uart_rx(rx), .uart_tx(tx), .ws2812(ws));

    // ---------- «Mac» передаёт: кадр 8N1 на линию rx (урок 9) ----------
    task send_byte (input [7:0] c);
        integer j;
        begin
            rx = 1'b0;  #(BIT_NS);
            for (j = 0; j < 8; j = j + 1) begin
                rx = c[j];  #(BIT_NS);
            end
            rx = 1'b1;  #(BIT_NS);
        end
    endtask

    // ---------- «Mac» принимает эхо (урок 9) ----------
    reg [7:0] echo = 8'h00;
    reg [7:0] b;
    integer   k;

    always begin
        @(negedge tx);
        #(BIT_NS / 2);
        for (k = 0; k < 8; k = k + 1) begin
            #(BIT_NS);
            b[k] = tx;
        end
        #(BIT_NS);
        echo = b;
    end

    // ---------- Приёмник WS2812 (практика 1) ----------
    reg  [23:0] grb, last = 24'h0;
    integer     nb = 0, frames = 0, errors = 0;
    realtime    t_rise;

    always begin
        @(posedge ws);
        t_rise = $realtime;
        @(negedge ws);
        grb = {grb[22:0], ($realtime - t_rise > 600.0)};
        nb  = nb + 1;
        if (nb == 24) begin
            nb = 0;
            frames = frames + 1;
            last = grb;
        end
    end

    // Набрать клавишу и дождаться двух полных кадров после неё.
    task key (input [7:0] c, input [23:0] want);
        integer f0;
        begin
            send_byte(c);
            f0 = frames;
            wait (frames == f0 + 2);
            $display("   %c     %c    %h %h %h    %h %h %h", c, echo,
                     last[23:16], last[15:8], last[7:0],
                     want[23:16], want[15:8], want[7:0]);
            if (last !== want || echo !== c) errors = errors + 1;
        end
    endtask

    initial begin
        $dumpfile("tb_top.vcd");
        $dumpvars(0, tb_top);
        #1013;
        wait (frames == 1);
        $display("после прошивки: %h %h %h (ожидали 1c 1c 1c)",
                 last[23:16], last[15:8], last[7:0]);
        if (last !== 24'h1c_1c_1c) errors = errors + 1;
        $display("клавиша эхо   G  R  B    ожидали");
        key("r", 24'h00_1c_00);
        key("5", 24'h00_8c_00);
        key("g", 24'h8c_00_00);
        key("y", 24'h8c_8c_00);
        key("x", 24'h8c_8c_00);           // не команда — цвет прежний
        key("0", 24'h00_00_00);
        key("9", 24'hfc_fc_00);
        key("c", 24'hfc_00_fc);
        if (errors == 0) $display("ТЕСТ ПРОЙДЕН");
        else             $display("ТЕСТ НЕ ПРОЙДЕН: ошибок %0d", errors);
        $finish;
    end
endmodule
